<!-- neru 장기기억(#2) 설계 스펙 — neru가 대화 중 기억할 만한 것을 remember 도구(function-calling)로 즉시 기록하고, MEMORY.md에 저장·회상한다 -->
# neru Long-term Memory (#2) — Design Spec

**Status:** Approved design (2026-07-16). Next: implementation plan (writing-plans).

## Goal

Give neru a production-style long-term memory, the way commercial assistants do it:
while talking, neru decides in the moment when something is worth remembering across
sessions and **calls a `remember` tool** to record it, so future conversations feel
continuous ("neru remembers me"). Memory is stored as a human-readable, editable
**`MEMORY.md`** file and injected back into neru's context each session. This is the
first vertical slice of the #2 subproject; the same wiring later extends to episodic
vector recall (RAG).

## Context & constraints

- Built on the vendored AIRI fork (`airi/`). Input is **text** right now (voice/STT on
  hold); memory is voice-independent and works with text input.
- LLM is the external local OpenAI-compatible proxy at `:3456` (baseUrl
  `http://localhost:3456/v1/`, model `claude-opus-4-7`, key `sk-local-proxy` — from
  `neruPreseed.ts`). It is not our code, but it is a Claude model behind an
  OpenAI-compatible surface.
- **Function-calling is supported — verified (2026-07-16).** A read-only probe posting a
  `remember` tool to `/v1/chat/completions` returned `finish_reason: "tool_calls"` with
  two correct, well-categorized `remember` calls. So a proper tool-call capture path is
  viable (this was the riskiest assumption and it passed).
- **Local-first, single desktop app.** No new server, no database engine — memory is a
  file on disk managed by the Electron app.
- AIRI already has a working tool system: builtin tools live in
  `airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/` (e.g. `widgets.ts`,
  `weather.ts`, `image-journal.ts`); each is `{ name, description, execute, parameters }`
  with a valibot schema run through `toJsonSchema`. The orchestrator runs the tool loop
  (`resolveTools` / `ToolMessage` / `withCapturedToolErrors` in
  `packages/core-agent/src/runtime/llm-service.ts`) and forwards tools into
  `deps.llm.stream(...)`.
- The persona card `NERU_SYSTEM_PROMPT`
  (`airi/packages/stage-ui/src/constants/neru-persona.ts`) is neru's sole system prompt.

### Codebase terrain (established by exploration, 2026-07-16)

- neru's live chat path has **no** memory/RAG wired in today. (`packages/memory-pgvector`
  is an empty stub; `services/telegram-bot` has a real pgvector recall pipeline but is
  self-contained and server-side; `core-agent`'s `compactConversationEntries` exists but
  is not called.)
- Context-injection insertion point: the orchestrator appends extra context onto the
  outgoing prompt at
  `airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts:635`
  (`formatContextPromptText(contextsSnapshot)` via `deps.context.snapshot()`), and it
  accepts runtime context providers (`deps.runtimeContextProviders`, ingested ~`:361-367`).
  This is where recalled memory is injected. The whole session history is already sent
  each turn — memory injection adds a small bounded block, not history.
- Builtin-tool shape to copy (`stores/tools/builtin/widgets.ts:312-319`): an object with
  `name`, `description`, `execute: params => …`, `parameters: <JSON schema>`; a NOTICE
  there warns that OpenAI-compatible tool validators reject strict object schemas, so the
  `parameters` schema must be non-strict (follow the `normalizeNullableAnyOf` pattern).
- Renderer persistence today is `unstorage`→IndexedDB (`stage-ui/src/database/storage.ts`);
  Electron IPC uses `@moeru/eventa` contracts. `MEMORY.md` file I/O goes through a
  main-process handler (renderer has no direct fs).

## Success criteria

- When neru learns something durable and significant (a fact about the user, a stated
  preference, ongoing context), it **calls the `remember` tool**, and that memory lands
  as a bullet under the right section of `MEMORY.md`.
- The tool call is silent to the audience — it is a structured tool round-trip, so it
  never appears in spoken audio or Korean subtitles (unlike free-text, tool calls are not
  part of the spoken content stream at all).
- On a later session, `MEMORY.md` content is present in neru's context, so neru can
  reference what it remembered.
- `MEMORY.md` is human-readable; the user can open and edit it, and edits take effect on
  the next session (the file is the source of truth).
- neru does not over-record trivia — only durable, significant memories (tuned by the tool
  description + a short persona note, like the ACT "only on significant change" guidance).
- If memory is empty/absent, recall injects nothing and everything else works unchanged.

## Architecture — four pieces

### Piece 1 — The `remember` tool (write trigger)

- **A new builtin tool** at
  `airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/remember.ts`, following the
  existing builtin-tool shape (`name`, `description`, `execute`, `parameters`) and
  registered alongside the other builtin tools so it is passed to the LLM every turn.
- **Name/description:** `name: 'remember'`; description states what to save and when —
  durable, significant facts about the user or the ongoing world; not small talk or
  transient state.
- **Parameters schema** (valibot → `toJsonSchema`, non-strict per the widgets NOTICE):
  `{ category: 'identity' | 'preference' | 'context' | 'misc', text: string }`.
- **`execute(params)`:** validates the args, calls the memory store's `appendMemory`
  (Piece 3), and returns a short confirmation string (e.g. `"Saved."`) so the model's
  tool round-trip completes cleanly. Invalid args → return a brief error string (the
  orchestrator's `withCapturedToolErrors` already turns tool errors into a normal tool
  result rather than crashing the turn).
- **Why a tool, not a streaming token:** the proxy supports function-calling (verified),
  tool calls are structured and never leak into TTS/subtitles, and this reuses AIRI's
  existing tool loop with no parser changes. (A `<|MEMORY|>` streaming-token variant was
  considered — it would mirror the `<|ACT|>` mechanism — but the tool path is the standard,
  "commercial-style" approach the design targets and is now verified to work.)

**Interface produced:** a registered `remember` tool whose `execute` calls
`useMemoryStore().appendMemory({category, text})`.

### Piece 2 — Persona / tool guidance (when to remember)

- The tool `description` is the primary "when to use" signal for the model.
- Add a short note to `NERU_SYSTEM_PROMPT` reinforcing it: remember durable, significant
  facts across sessions (a fact about the user, a preference, ongoing context); do **not**
  save small talk, transient state, or things already obviously known; it is fine to save
  nothing in a turn. This is the anti-spam tuning knob, the same class as the ACT
  over-switching guidance already in the persona.

### Piece 3 — `MEMORY.md` store (persistence)

- **Source of truth:** a single markdown file at
  `<app userData>/neru-memory/MEMORY.md`. No IndexedDB mirror — the file *is* the memory.
- **Format** — sectioned by category, one bullet per memory, optional date:

  ```markdown
  # neru's memory

  ## Identity
  - The user is building neru, a Neuro-sama-class AI VTuber. (2026-07-16)

  ## Preferences
  - Speaks Korean, wants English voice output with Korean subtitles. (2026-07-16)

  ## Context
  - Currently working on the long-term-memory subproject. (2026-07-16)

  ## Misc
  ```

- **Write path:** a renderer-side memory store
  (`airi/packages/stage-ui/src/stores/modules/memory.ts`, following the module pattern of
  `stores/modules/consciousness.ts`) exposes `appendMemory({category, text})`. It asks the
  Electron main process (via an `@moeru/eventa` IPC contract) to append the bullet under the
  matching `## <Category>` section, creating the file/section if absent. Writes are
  serialized through a single main-process writer (one in-flight write at a time) so
  concurrent tool calls in one reply don't corrupt the file.
- **Light dedup:** before appending, skip if an identical (case-insensitive, trimmed)
  bullet already exists in that section. No automatic supersession/consolidation in the
  MVP (the file is user-editable, and consolidation is out of scope — see YAGNI).
- **Read path:** the store loads `MEMORY.md` text at session start (and refreshes after a
  write) via the same IPC, exposing a reactive `memoryText` ref.

**Interface produced:** `useMemoryStore()` with `appendMemory({category, text})`,
`loadMemory(): Promise<string>`, and a reactive `memoryText` ref.

### Piece 4 — Recall (injection into context)

- A **runtime context provider** (registered with the chat orchestrator via
  `deps.runtimeContextProviders`) surfaces the current `MEMORY.md` content as a compact
  block, injected at the existing insertion point
  (`chat-orchestrator-runtime.ts:635`). It rides in every turn's prompt; the persona card
  is untouched.
- **Rendered block** (example):

  ```
  What you remember about the user and this world (from past sessions):
  <contents of MEMORY.md, headers and bullets>
  ```

- **Bounded:** cap the injected block to a character budget (e.g. ~2–4 KB). If `MEMORY.md`
  exceeds it, include the most recent bullets per section and note truncation. (Relevance-
  ranked/semantic recall is the future RAG extension, out of scope here.)
- **No-op** when the file is empty or missing.

## Data flow

```
neru is replying (streaming from the LLM proxy, with the remember tool available)
  → model decides a fact is worth keeping → emits a tool_call remember({category,text})
  → AIRI tool loop runs remember.execute → useMemoryStore().appendMemory
        → Electron main appends the bullet to MEMORY.md (serialized)
  → tool returns "Saved." → model continues/finishes the reply
  → the spoken English + <ko> subtitle + <|ACT|> face proceed unchanged
     (the tool call is structured, never in the spoken content)

next turn / next session
  → recall context provider reads MEMORY.md
  → injects a bounded memory block at chat-orchestrator-runtime.ts:635
  → neru's prompt now contains what it remembered → continuity
```

## Error handling & edge cases

- **Invalid tool args** (unknown category, empty text) → `execute` returns a brief error
  string; `withCapturedToolErrors` surfaces it as a normal tool result; nothing is written;
  the turn continues.
- **File write failure** (fs error) → logged via `errorMessageFrom(error)`; `execute`
  returns an error result; no crash, conversation continues.
- **`MEMORY.md` missing** → recall injects nothing; the first successful write creates the
  file and section.
- **Corrupt/hand-broken file** → recall injects the raw text (it is just markdown); a
  malformed file cannot crash startup because it is treated as opaque text, not parsed into
  a schema. The write path only appends under `## <Category>` headers, creating a header if
  none matches.
- **Concurrent writes** (two `remember` calls in one reply) → serialized through the single
  main-process writer queue; each append re-reads, edits, writes.
- **Over-recording** → bounded by the tool description + persona guardrails (tuned like
  ACT); the user can prune the file directly.
- **Tool-schema compatibility** → the `parameters` schema must be non-strict for
  OpenAI-compatible validators (follow the widgets `normalizeNullableAnyOf` pattern).
- **Privacy** → entirely local. Memory text is only ever sent to the local LLM proxy at
  `:3456`, which already sees the conversation. Nothing leaves the machine.

## Testing

- **Unit:**
  - `remember.execute`: valid args call `appendMemory` once with the parsed `{category,
    text}` and return the confirmation; invalid args (bad category, empty text) return an
    error result and do NOT call `appendMemory`.
  - Store append: appends under the right section; creates file/section when absent; skips
    an exact duplicate bullet; two appends serialize without loss.
  - Recall render: `MEMORY.md` text → bounded block; over-budget input is truncated;
    empty/missing file → empty block (no-op).
- **Integration-style:** with a mocked LLM stream emitting a `remember` tool_call, assert
  the store's `appendMemory` is called and the recall provider surfaces the file's contents
  into the orchestrator's context snapshot (mock the orchestrator seam, as the barge-in
  tests do).
- **Manual:** talk to neru until it saves something → confirm the bullet appears in
  `MEMORY.md` and nothing leaks into speech/subtitles → restart → confirm neru recalls it →
  edit the file by hand → confirm the edit takes effect next session.

## Decisions

- **D1 — Write mechanism = a `remember` function-calling tool.** The local proxy at `:3456`
  supports function-calling — **verified 2026-07-16** by a probe that returned proper
  `tool_calls`. Tool calls are structured (never leak into TTS/subtitles), reuse AIRI's
  existing tool loop, and are the standard "commercial-style" approach. A `<|MEMORY|>`
  streaming-token variant (mirroring `<|ACT|>`) was considered and set aside.
- **D2 — Storage = a single `MEMORY.md` markdown file** as the source of truth (no
  IndexedDB), managed by the Electron main process. Human-readable and editable by design,
  which satisfies the transparency requirement inherently.
- **D3 — Capture is agentic (model-decided), in the moment** — neru saves when it judges
  something worth remembering. No separate batched background-extraction pass (that earlier
  option is superseded by this one).
- **D4 — Recall injects the whole (bounded) `MEMORY.md`** into every turn's prompt via the
  existing context-provider insertion point, like a persona addendum. Semantic/relevance
  ranking is deferred to the RAG extension.
- **D5 — Writes are append-oriented with light exact-duplicate dedup.** Automatic
  supersession/consolidation is deferred; the editable file plus manual pruning cover the
  MVP.

## Out of scope (YAGNI)

- Episodic vector recall / RAG (embeddings + vector store) — the planned next slice of #2,
  which reuses this design's `remember`/store hook and the injection point.
- Claude-style split store (a `MEMORY.md` index + per-memory files) — start with one file.
- A settings-panel UI to browse/edit memories — the editable file is the MVP surface.
- Automatic consolidation, deduping by meaning, forgetting/decay, importance scoring.
- Cross-device sync; multi-user profiles.
- A streaming-token capture path — set aside in favor of the verified tool path.

## Open risks

- **Over/under-recording** is a prompt/description-tuning problem, same class as the ACT
  over-switching we already tuned; expect a tuning pass after first runtime use.
- **Unbounded `MEMORY.md` growth** over months → handled at recall by the character budget;
  consolidation is a known future task.
- **Tool-schema strictness** → OpenAI-compatible validators reject strict object schemas;
  mitigated by following the existing `normalizeNullableAnyOf` pattern in `widgets.ts`.
