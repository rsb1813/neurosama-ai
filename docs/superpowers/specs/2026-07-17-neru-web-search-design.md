# neru Web Search (#internet) — Design Spec

**Status:** Design approved (brainstorming), ready for implementation plan.
**Date:** 2026-07-17
**Subproject:** #internet (web capability) — this spec covers **web search only**.

## Goal

Give neru the ability to look things up on the web when she is unsure or needs
current information, so she can answer and react like a real streamer ("let me
search that"). She decides when to search; results come back as short snippets
she reads and speaks.

## Scope

**In scope:** web *search* — a query returns a ranked list of result snippets
(title, URL, short text). neru reads the snippets and responds.

**Explicitly out of scope (deferred):**
- Opening / reading full web pages → deferred to **#7 (computer control / coding agent)**.
- Saving search results to long-term memory (#2). Search results are ephemeral.
- MCP-server integration (AIRI has MCP infra, but a builtin tool is simpler here — see Rejected alternatives).
- A multi-provider abstraction. One backend (SearXNG) is enough (YAGNI).

## Backend: self-hosted SearXNG

Search is served by a **self-hosted SearXNG** instance — a metasearch
aggregator (Google/Bing/DuckDuckGo/Brave/… combined) with a JSON API, no API
key, no per-query cost, and privacy (queries aren't tracked by a single vendor).
This fits the project's local/private ethos (local TTS/STT, local LLM proxy) and
is the de-facto choice for local-LLM web search (Perplexica, Open WebUI,
LibreChat all use it).

- **Deployment:** Docker Compose, **started manually** (`docker compose up`).
  neru treats search as an **optional dependency** — if SearXNG is down, neru
  degrades gracefully (says she can't search), never crashes.
- **JSON API:** `GET {SEARXNG}/search?q=<query>&format=json` → `{ results: [{ title, url, content, ... }], ... }`.
  The compose config must enable the `json` output format (SearXNG disables it
  by default) and bind to localhost only.
- **Config knob:** `NERU_SEARXNG_URL` (default `http://localhost:8888`), plus a
  result-count cap.

Honest trade-offs (accepted): SearXNG returns **raw snippets** (not LLM-summarized
like Tavily) — fine, the LLM reads snippets well and we keep control of formatting.
Reliability depends on upstream engines not rate-limiting the instance (occasional
captchas), mitigated by aggregating several engines. One more local container to run.

## Architecture

neru side = a **builtin `webSearch` LLM tool** (same pattern as the just-shipped
`remember` tool and the existing `weather` tool). It is **always-on** (available
every turn via `resolveTools`, like `remember`), so neru can call it whenever she
judges she needs to look something up. The persona guides *when* to search.

**Network path = main-process IPC** (mirrors the memory service), NOT a direct
renderer `fetch`. Rationale: the existing `weather` tool fetches public APIs
directly from the renderer, which works only because those APIs send permissive
CORS headers. Self-hosted SearXNG does **not** send CORS headers by default, so a
renderer→`localhost:8888` fetch would be blocked. Routing the HTTP call through
the **main process** (Node, no CORS) is robust, needs no SearXNG CORS config, and
works in a packaged (`file://`) build too. This reuses the memory-feature
architecture (renderer tool → eventa IPC → main service does the I/O).

```
neru decides to search
  → webSearch({query}) tool (renderer, always-on)
    → IPC electronWebSearch({query})
      → main WebSearchService: GET {NERU_SEARXNG_URL}/search?q=…&format=json  (timeout ~8s)
        → parse results[] → top-N { title, url, snippet }
      ← { results }  (or { error } on failure)
    ← tool formats results as a short text block for the LLM
  → LLM reads snippets → neru speaks (English + <ko> subtitle, per persona)
```

## Components (files)

| Piece | Path | Role |
|-------|------|------|
| SearXNG service | `infra/searxng/docker-compose.yml` (+ minimal `settings.yml`) | self-hosted search; JSON format on, localhost bind, a `secret_key` |
| Main search service | `airi/apps/stage-tamagotchi/src/main/services/airi/web-search/index.ts` | `createWebSearchService`: fetch SearXNG JSON, map to top-N `{title,url,snippet}`, timeout + graceful errors |
| Eventa contract | `airi/apps/stage-tamagotchi/src/shared/eventa/index.ts` | `electronWebSearch({query}) → { results }` (append to existing contracts file) |
| Renderer IPC wrapper | `airi/apps/stage-tamagotchi/src/renderer/web-search-io.ts` | thin `useElectronEventaInvoke` wrapper (like `memory-io.ts`) |
| Builtin tool | `airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/web-search.ts` | `webSearch` tool (zod `{query}`), formats results text; always-on wiring in `chat-sync.ts` `resolveTools` |
| Persona guidance | `airi/packages/stage-ui/src/constants/neru-persona.ts` | a SEARCH block: search when unsure / for current info; don't hallucinate; cite briefly; don't over-search |
| Config | main service reads `NERU_SEARXNG_URL` (default `http://localhost:8888`) + result count | |

Pure result-mapping/formatting helpers (SearXNG JSON → top-N snippet text) live in
a small unit-testable module so they can be tested without the network.

## Data shapes

- Tool params (zod): `{ query: string }` — the search query (neru phrases it).
- SearXNG result (subset used): `{ title: string, url: string, content: string }`.
- Service return: `{ results: Array<{ title, url, snippet }> }` (top-N, default N≈5)
  or an error signal.
- Tool output to the LLM: a short plain-text list, e.g.
  `1. <title> — <snippet> (<url>)` per result, capped in count and length so it
  doesn't blow the prompt budget.

## Error handling

The tool must **never throw into the turn**. It returns a clear string the LLM can
act on:
- SearXNG unreachable / connection refused / timeout (~8s) → "search is
  unavailable right now" → neru says she can't search.
- HTTP non-200 → same graceful message.
- Empty results → "no results found for that query."
Search being an optional dependency means neru works normally with SearXNG off.

## Testing

- **Unit (pure):** SearXNG-JSON → top-N snippet mapping/formatting — normal,
  empty results, malformed JSON, count/length capping.
- **Main service:** mock `fetch` — success, connection error, timeout, non-200,
  malformed body → assert graceful `{error}` / mapped results.
- **Tool:** mock the IPC wrapper — assert formatted output, empty-result message,
  and graceful error string (never throws).
- **Manual (end-to-end):** `docker compose up` SearXNG, ask neru something current
  in Korean → she calls `webSearch` → answers from real results; then stop
  SearXNG → she degrades gracefully.

## Rejected alternatives

- **MCP server (SearXNG MCP via AIRI's MCP bridge):** AIRI has MCP infra, but this
  adds a second process (SearXNG container + an MCP server + AIRI MCP config) and
  cedes control over result shaping and persona integration. SearXNG already
  exposes a clean JSON API we can call directly. YAGNI — rejected.
- **Renderer-direct `fetch` + SearXNG CORS config:** lighter (pure renderer tool
  like `weather`), but depends on fronting SearXNG with CORS headers (reverse
  proxy) and is fragile across dev (`localhost:5173`) vs packaged (`file://`)
  origins. Main-process IPC is more robust and reuses the memory pattern. Rejected
  as primary; kept as a fallback note only.
- **Hosted search APIs (Tavily / Brave / DuckDuckGo):** good quality, but Tavily/Brave
  need API keys/accounts and DuckDuckGo scraping is flaky. Self-hosting fits the
  project's local/privacy ethos better and costs nothing per query.
- **Vector-DB / RAG over crawled pages:** massive over-build for "let neru look
  things up." Out of scope.

## Open questions (settle during implementation)

- Exact SearXNG `settings.yml` needed to enable `format=json` and restrict engines
  — verify against the installed SearXNG image at implementation time.
- SearXNG port (compose default vs `:8888`) — pick one, wire `NERU_SEARXNG_URL`.
- Result count N and per-snippet length cap — tune so the tool result stays a
  small, readable block.
