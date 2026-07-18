# neru Web Search (#internet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give neru an always-on `webSearch` LLM tool that queries a self-hosted SearXNG instance (via the Electron main process) and returns ranked snippets she reads and speaks.

**Architecture:** Renderer builtin tool `webSearch` → eventa IPC → main-process `WebSearchService` fetches SearXNG's JSON API and maps it to top-N `{title,url,snippet}`. The HTTP call lives in the main process (Node, no CORS) because self-hosted SearXNG sends no CORS headers, so a renderer→localhost fetch would be blocked. Mirrors the existing long-term-memory IPC architecture. Search is an optional dependency: if SearXNG is down the tool returns a graceful string and never throws.

**Tech Stack:** TypeScript, Electron (main + renderer), `@moeru/eventa` (IPC), `@xsai/tool` + `zod` (LLM tool), `@moeru/std` (`errorMessageFrom`), Vitest. SearXNG via Docker Compose.

## Global Constraints

- **Tool must NEVER throw into the turn** — every failure path returns a short human-readable string for the LLM.
- **Network I/O is main-process only** — the renderer must not `fetch` SearXNG directly (CORS). Renderer talks to main via the `electronWebSearch` eventa contract.
- **Package boundary:** the Electron main process must NOT import `@proj-airi/stage-ui`. Shared IPC types live in `apps/stage-tamagotchi/src/shared/eventa`.
- **New source files start with a one-line Korean comment** describing the file's role. Comments Korean; identifiers/strings English. Config files (docker-compose.yml, *.config.ts, package.json) are exempt.
- **Error extraction:** use `errorMessageFrom(error)` from `@moeru/std` (pair with `?? 'fallback'`), not manual `instanceof` checks.
- **Config defaults (verbatim):** `NERU_SEARXNG_URL` default `http://localhost:8888`; `MAX_RESULTS = 5`; `SNIPPET_MAX_CHARS = 300`; `TIMEOUT_MS = 8000`.
- **Tool params use `zod`** (`z.object`) like the `remember`/`get_weather` tools — `@xsai/tool` converts to JSON Schema.
- Branch `feat/neru-web-search` already exists (spec committed). Do not create the branch.
- Reuse the memory-feature files as the reference pattern: `apps/stage-tamagotchi/src/main/services/airi/memory/index.ts`, `.../renderer/memory-io.ts`, `.../shared/eventa/index.ts`, `.../renderer/stores/tools/builtin/memory.ts`, `.../renderer/stores/chat-sync.ts` (`resolveTools`), `packages/stage-ui/src/constants/neru-persona.ts`.

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `airi/apps/stage-tamagotchi/src/shared/eventa/index.ts` | Modify (append near the memory contracts, ~line 331) | Declare `SearchResultItem`, `ElectronWebSearchResult`, and the `electronWebSearch` IPC contract |
| `airi/apps/stage-tamagotchi/src/main/services/airi/web-search/searxng.ts` | Create | Pure `mapSearxngResults` + `searchSearxng` (fetch + timeout + graceful error) |
| `airi/apps/stage-tamagotchi/src/main/services/airi/web-search/searxng.test.ts` | Create | Unit tests for both |
| `airi/apps/stage-tamagotchi/src/main/services/airi/web-search/index.ts` | Create | `createWebSearchService({context})` — thin IPC glue |
| `airi/apps/stage-tamagotchi/src/main/windows/main/rpc/index.electron.ts` | Modify (~line 54) | Register `createWebSearchService({ context })` |
| `airi/apps/stage-tamagotchi/src/renderer/web-search-io.ts` | Create | Renderer IPC wrapper (`searchWeb`) |
| `airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/web-search.ts` | Create | `webSearch` builtin tool + LLM text formatter + `webSearchTools` |
| `airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/web-search.test.ts` | Create | Tool + formatter tests (graceful, never throws) |
| `airi/apps/stage-tamagotchi/src/renderer/stores/chat-sync.ts` | Modify (~line 314-318) | Add `webSearchTools()` to the always-on `resolveTools` base |
| `airi/packages/stage-ui/src/constants/neru-persona.ts` | Modify | Add a SEARCH guidance block to `NERU_SYSTEM_PROMPT` |
| `airi/packages/stage-ui/src/constants/neru-persona.test.ts` | Modify | Assert the SEARCH block is present |
| `infra/searxng/docker-compose.yml` | Create | Self-hosted SearXNG service |
| `infra/searxng/settings.yml` | Create | Enable JSON format, localhost bind, secret |
| `infra/searxng/README.md` | Create | How to run SearXNG for neru |

---

## Task 1: Shared IPC contract + pure SearXNG mapping

**Files:**
- Modify: `airi/apps/stage-tamagotchi/src/shared/eventa/index.ts` (append after the memory contracts, ~line 331)
- Create: `airi/apps/stage-tamagotchi/src/main/services/airi/web-search/searxng.ts`
- Test: `airi/apps/stage-tamagotchi/src/main/services/airi/web-search/searxng.test.ts`

**Interfaces:**
- Produces:
  - `interface SearchResultItem { title: string, url: string, snippet: string }` (in shared/eventa)
  - `interface ElectronWebSearchResult { results: SearchResultItem[], error?: string }` (in shared/eventa)
  - `const electronWebSearch` — `defineInvokeEventa<ElectronWebSearchResult, { query: string }>('eventa:invoke:electron:web-search:query')`
  - `function mapSearxngResults(json: unknown, maxResults: number, snippetMaxChars: number): SearchResultItem[]`

- [ ] **Step 1: Add the shared contract + types**

Append to `airi/apps/stage-tamagotchi/src/shared/eventa/index.ts` immediately after the memory contract block (after the `electronMemoryWriteText` line, ~line 330):

```ts
export interface SearchResultItem { title: string, url: string, snippet: string }
export interface ElectronWebSearchResult { results: SearchResultItem[], error?: string }

// 웹 검색은 메인 프로세스가 수행한다(자체 호스팅 SearXNG는 CORS 헤더가 없어 렌더러 직접 fetch 불가).
export const electronWebSearch = defineInvokeEventa<ElectronWebSearchResult, { query: string }>('eventa:invoke:electron:web-search:query')
```

- [ ] **Step 2: Write the failing test**

Create `airi/apps/stage-tamagotchi/src/main/services/airi/web-search/searxng.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { mapSearxngResults } from './searxng'

describe('mapSearxngResults', () => {
  it('maps title/url/content and caps the count', () => {
    const json = {
      results: [
        { title: 'A', url: 'https://a.example', content: 'alpha' },
        { title: 'B', url: 'https://b.example', content: 'beta' },
        { title: 'C', url: 'https://c.example', content: 'gamma' },
      ],
    }
    const out = mapSearxngResults(json, 2, 300)
    expect(out).toEqual([
      { title: 'A', url: 'https://a.example', snippet: 'alpha' },
      { title: 'B', url: 'https://b.example', snippet: 'beta' },
    ])
  })

  it('returns [] when results is missing or not an array', () => {
    expect(mapSearxngResults({}, 5, 300)).toEqual([])
    expect(mapSearxngResults({ results: null }, 5, 300)).toEqual([])
    expect(mapSearxngResults('not json', 5, 300)).toEqual([])
  })

  it('skips items missing a title or url', () => {
    const json = { results: [
      { title: '', url: 'https://x', content: 'c' },
      { title: 'ok', url: '', content: 'c' },
      { title: 'good', url: 'https://good', content: 'c' },
    ] }
    expect(mapSearxngResults(json, 5, 300)).toEqual([{ title: 'good', url: 'https://good', snippet: 'c' }])
  })

  it('truncates snippet to snippetMaxChars with an ellipsis', () => {
    const json = { results: [{ title: 't', url: 'https://u', content: 'x'.repeat(50) }] }
    const [item] = mapSearxngResults(json, 5, 10)
    expect(item.snippet).toBe(`${'x'.repeat(10)}…`)
  })

  it('tolerates missing content (empty snippet)', () => {
    const json = { results: [{ title: 't', url: 'https://u' }] }
    expect(mapSearxngResults(json, 5, 300)).toEqual([{ title: 't', url: 'https://u', snippet: '' }])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm exec vitest run apps/stage-tamagotchi/src/main/services/airi/web-search/searxng.test.ts`
Expected: FAIL — cannot find module `./searxng` / `mapSearxngResults is not a function`.

- [ ] **Step 4: Implement `mapSearxngResults`**

Create `airi/apps/stage-tamagotchi/src/main/services/airi/web-search/searxng.ts`:

```ts
// SearXNG JSON 검색 응답을 다루는 순수 헬퍼 — neru가 쓸 상위 N개 스니펫으로 정규화한다.
import type { SearchResultItem } from '../../../../shared/eventa'

interface SearxngRawResult {
  title?: string
  url?: string
  content?: string
}

// SearXNG 응답에서 유효한 결과만 골라 상위 maxResults개를 {title,url,snippet}로 정규화한다.
// title/url이 비면 버린다. snippet은 content(없으면 '')를 snippetMaxChars 상한으로 자른다.
export function mapSearxngResults(json: unknown, maxResults: number, snippetMaxChars: number): SearchResultItem[] {
  const raw = (json as { results?: unknown })?.results
  const list: SearxngRawResult[] = Array.isArray(raw) ? raw : []
  const items: SearchResultItem[] = []
  for (const r of list) {
    if (items.length >= maxResults)
      break
    const title = (r?.title ?? '').trim()
    const url = (r?.url ?? '').trim()
    if (!title || !url)
      continue
    const content = (r?.content ?? '').trim()
    const snippet = content.length > snippetMaxChars ? `${content.slice(0, snippetMaxChars)}…` : content
    items.push({ title, url, snippet })
  }
  return items
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run apps/stage-tamagotchi/src/main/services/airi/web-search/searxng.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm -F @proj-airi/stage-tamagotchi typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add airi/apps/stage-tamagotchi/src/shared/eventa/index.ts airi/apps/stage-tamagotchi/src/main/services/airi/web-search/searxng.ts airi/apps/stage-tamagotchi/src/main/services/airi/web-search/searxng.test.ts
git commit -m "feat(stage-tamagotchi): web-search IPC contract + pure SearXNG result mapping"
```

---

## Task 2: SearXNG fetch client + main-process IPC service

**Files:**
- Modify: `airi/apps/stage-tamagotchi/src/main/services/airi/web-search/searxng.ts` (add `searchSearxng`)
- Modify: `airi/apps/stage-tamagotchi/src/main/services/airi/web-search/searxng.test.ts` (add fetch tests)
- Create: `airi/apps/stage-tamagotchi/src/main/services/airi/web-search/index.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/windows/main/rpc/index.electron.ts` (~line 54)

**Interfaces:**
- Consumes: `mapSearxngResults` (Task 1); `ElectronWebSearchResult`, `electronWebSearch` (Task 1).
- Produces:
  - `function searchSearxng(query: string, opts: { baseUrl: string, maxResults: number, snippetMaxChars: number, timeoutMs: number }): Promise<ElectronWebSearchResult>` — never throws; returns `{results}` or `{results: [], error}`.
  - `function createWebSearchService(params: { context: ReturnType<typeof createContext>['context'] }): void`

- [ ] **Step 1: Write the failing test for `searchSearxng`**

In `airi/apps/stage-tamagotchi/src/main/services/airi/web-search/searxng.test.ts`, first **merge the imports** so there is a single `vitest` import and a single `./searxng` import (avoids a duplicate-import lint error):

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mapSearxngResults, searchSearxng } from './searxng'
```

Then append this block after the existing `describe('mapSearxngResults', ...)`:

```ts
const OPTS = { baseUrl: 'http://localhost:8888', maxResults: 5, snippetMaxChars: 300, timeoutMs: 8000 }

describe('searchSearxng', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns mapped results on a 200 JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ title: 'T', url: 'https://u', content: 'c' }] }),
    })))
    const out = await searchSearxng('cats', OPTS)
    expect(out).toEqual({ results: [{ title: 'T', url: 'https://u', snippet: 'c' }] })
  })

  it('returns an error (no throw) on a non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })))
    const out = await searchSearxng('cats', OPTS)
    expect(out.results).toEqual([])
    expect(out.error).toContain('502')
  })

  it('returns an error (no throw) when fetch rejects (SearXNG down / timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const out = await searchSearxng('cats', OPTS)
    expect(out.results).toEqual([])
    expect(out.error).toBeTruthy()
  })

  it('returns an error (no throw) on malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json') } })))
    const out = await searchSearxng('cats', OPTS)
    expect(out.results).toEqual([])
    expect(out.error).toBeTruthy()
  })

  it('returns an error for an empty query without calling fetch', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const out = await searchSearxng('   ', OPTS)
    expect(out.error).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run apps/stage-tamagotchi/src/main/services/airi/web-search/searxng.test.ts`
Expected: FAIL — `searchSearxng is not a function`.

- [ ] **Step 3: Implement `searchSearxng`**

Append to `airi/apps/stage-tamagotchi/src/main/services/airi/web-search/searxng.ts` (add the import of `ElectronWebSearchResult` to the existing type import line, and `errorMessageFrom`):

```ts
import type { ElectronWebSearchResult, SearchResultItem } from '../../../../shared/eventa'

import { errorMessageFrom } from '@moeru/std'
```

Then append:

```ts
export interface SearchSearxngOptions {
  baseUrl: string
  maxResults: number
  snippetMaxChars: number
  timeoutMs: number
}

// SearXNG JSON API를 호출해 상위 N개 결과를 돌려준다. 검색은 선택적 의존성이라 절대 throw하지 않고
// 실패(미기동/타임아웃/비200/깨진 JSON)는 { results: [], error }로 우아하게 반환한다.
export async function searchSearxng(query: string, opts: SearchSearxngOptions): Promise<ElectronWebSearchResult> {
  const q = query.trim()
  if (!q)
    return { results: [], error: 'empty query' }

  try {
    const url = `${opts.baseUrl}/search?q=${encodeURIComponent(q)}&format=json`
    const res = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs) })
    if (!res.ok)
      return { results: [], error: `search backend returned ${res.status}` }
    const json = await res.json()
    return { results: mapSearxngResults(json, opts.maxResults, opts.snippetMaxChars) }
  }
  catch (error) {
    return { results: [], error: errorMessageFrom(error) ?? 'web search unavailable' }
  }
}
```

Note: the file's first import line becomes `import type { ElectronWebSearchResult, SearchResultItem } from '../../../../shared/eventa'` (SearchResultItem is still used by `mapSearxngResults`).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run apps/stage-tamagotchi/src/main/services/airi/web-search/searxng.test.ts`
Expected: PASS (10 tests total).

- [ ] **Step 5: Create the IPC service**

Create `airi/apps/stage-tamagotchi/src/main/services/airi/web-search/index.ts`:

```ts
// SearXNG 웹 검색을 수행하는 메인 프로세스 서비스 — 렌더러의 webSearch IPC(electronWebSearch)를 처리한다.
// 렌더러가 아니라 메인에서 fetch하는 이유: 자체 호스팅 SearXNG는 CORS 헤더를 주지 않아
// 렌더러(dev localhost:5173 / 패키지 file://)에서 직접 부르면 막힌다. 메인(Node)엔 CORS 제약이 없다.
import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { defineInvokeHandler } from '@moeru/eventa'

import { electronWebSearch } from '../../../../shared/eventa'
import { searchSearxng } from './searxng'

// SearXNG 접속 주소는 env로 재정의 가능(기본 로컬 Docker Compose 포트).
const BASE_URL = process.env.NERU_SEARXNG_URL ?? 'http://localhost:8888'
const MAX_RESULTS = 5
const SNIPPET_MAX_CHARS = 300
const TIMEOUT_MS = 8000

export function createWebSearchService(params: { context: ReturnType<typeof createContext>['context'] }) {
  defineInvokeHandler(params.context, electronWebSearch, async (payload) => {
    return searchSearxng(payload.query ?? '', {
      baseUrl: BASE_URL,
      maxResults: MAX_RESULTS,
      snippetMaxChars: SNIPPET_MAX_CHARS,
      timeoutMs: TIMEOUT_MS,
    })
  })
}
```

- [ ] **Step 6: Register the service**

In `airi/apps/stage-tamagotchi/src/main/windows/main/rpc/index.electron.ts`, add the import near the other service imports (next to the `createMemoryService` import at ~line 22):

```ts
import { createWebSearchService } from '../../../services/airi/web-search'
```

And register it right after the `createMemoryService({ context })` call (~line 54):

```ts
createWebSearchService({ context })
```

- [ ] **Step 7: Typecheck**

Run: `pnpm -F @proj-airi/stage-tamagotchi typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add airi/apps/stage-tamagotchi/src/main/services/airi/web-search/ airi/apps/stage-tamagotchi/src/main/windows/main/rpc/index.electron.ts
git commit -m "feat(stage-tamagotchi): main-process SearXNG web-search IPC service"
```

---

## Task 3: Renderer IPC wrapper + webSearch tool + always-on wiring

**Files:**
- Create: `airi/apps/stage-tamagotchi/src/renderer/web-search-io.ts`
- Create: `airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/web-search.ts`
- Test: `airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/web-search.test.ts`
- Modify: `airi/apps/stage-tamagotchi/src/renderer/stores/chat-sync.ts` (~line 314-318, and the import block ~line 22)

**Interfaces:**
- Consumes: `electronWebSearch`, `ElectronWebSearchResult`, `SearchResultItem` (Task 1).
- Produces:
  - `function searchWeb(query: string): Promise<ElectronWebSearchResult>` (in web-search-io.ts)
  - `function formatSearchResults(result: ElectronWebSearchResult): string` (in web-search.ts)
  - `function executeWebSearch(input: { query: string }): Promise<string>` (in web-search.ts)
  - `const webSearchTools = async () => Promise<Tool[]>` (in web-search.ts)

- [ ] **Step 1: Create the renderer IPC wrapper**

Create `airi/apps/stage-tamagotchi/src/renderer/web-search-io.ts` (mirrors `memory-io.ts`):

```ts
// neru 웹 검색을 렌더러에서 IPC로 감싼 얇은 래퍼 (도구가 사용, 테스트에서 모킹).
import type { ElectronWebSearchResult } from '../shared/eventa'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'

import { electronWebSearch } from '../shared/eventa'

export async function searchWeb(query: string): Promise<ElectronWebSearchResult> {
  const invoke = useElectronEventaInvoke(electronWebSearch)
  return invoke({ query })
}
```

- [ ] **Step 2: Write the failing test**

Create `airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/web-search.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../web-search-io', () => ({ searchWeb: vi.fn() }))

import { searchWeb } from '../../../web-search-io'
import { executeWebSearch, formatSearchResults } from './web-search'

const mockedSearchWeb = vi.mocked(searchWeb)

describe('formatSearchResults', () => {
  it('formats a numbered list of title — snippet (url)', () => {
    const text = formatSearchResults({ results: [
      { title: 'Cats', url: 'https://cats.example', snippet: 'about cats' },
      { title: 'Dogs', url: 'https://dogs.example', snippet: 'about dogs' },
    ] })
    expect(text).toContain('1. Cats — about cats (https://cats.example)')
    expect(text).toContain('2. Dogs — about dogs (https://dogs.example)')
  })

  it('reports unavailability when there is an error', () => {
    expect(formatSearchResults({ results: [], error: 'boom' })).toMatch(/could not|unavailable/i)
  })

  it('reports no results when the list is empty and there is no error', () => {
    expect(formatSearchResults({ results: [] })).toMatch(/no results/i)
  })
})

describe('executeWebSearch', () => {
  beforeEach(() => mockedSearchWeb.mockReset())

  it('returns an error string for an empty query without searching', async () => {
    const out = await executeWebSearch({ query: '  ' })
    expect(out).toMatch(/error/i)
    expect(mockedSearchWeb).not.toHaveBeenCalled()
  })

  it('returns formatted results on success', async () => {
    mockedSearchWeb.mockResolvedValue({ results: [{ title: 'T', url: 'https://u', snippet: 's' }] })
    const out = await executeWebSearch({ query: 'cats' })
    expect(out).toContain('1. T — s (https://u)')
  })

  it('never throws — returns a graceful string when the IPC call rejects', async () => {
    mockedSearchWeb.mockRejectedValue(new Error('ipc down'))
    const out = await executeWebSearch({ query: 'cats' })
    expect(out).toMatch(/could not|unavailable|error/i)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm exec vitest run apps/stage-tamagotchi/src/renderer/stores/tools/builtin/web-search.test.ts`
Expected: FAIL — cannot find module `./web-search`.

- [ ] **Step 4: Implement the tool**

Create `airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/web-search.ts`:

```ts
// neru가 웹을 검색하는 webSearch 도구 — SearXNG 결과를 LLM이 읽을 텍스트로 돌려준다.
import type { ElectronWebSearchResult } from '../../../../shared/eventa'
import type { Tool } from '@xsai/shared-chat'

import { errorMessageFrom } from '@moeru/std'
import { tool } from '@xsai/tool'
import { z } from 'zod'

import { searchWeb } from '../../../web-search-io'

const webSearchParams = z.object({
  query: z.string().describe('The web search query, phrased as a concise search string (English is fine).'),
})

// 검색 결과를 LLM이 읽을 짧은 텍스트로 만든다. 에러/무결과도 사람이 읽을 문장으로 반환(도구는 throw 금지).
export function formatSearchResults(result: ElectronWebSearchResult): string {
  if (result.error)
    return `Web search could not run right now (${result.error}). Tell the user you can't search at the moment.`
  if (result.results.length === 0)
    return 'Web search returned no results for that query.'
  const lines = result.results.map((r, i) => `${i + 1}. ${r.title} — ${r.snippet} (${r.url})`)
  return `Web search results:\n${lines.join('\n')}`
}

// 도구 로직 본체 — 테스트가 직접 부른다(IPC 래퍼 searchWeb은 모킹).
export async function executeWebSearch(input: { query: string }): Promise<string> {
  if (!input.query || input.query.trim().length === 0)
    return 'error: empty search query'
  try {
    const result = await searchWeb(input.query)
    return formatSearchResults(result)
  }
  catch (error) {
    // IPC 자체 실패도 크래시 없이 문장으로. (SearXNG 오류는 서비스가 이미 error 필드로 처리)
    return `Web search could not run right now (${errorMessageFrom(error) ?? 'unavailable'}). Tell the user you can't search at the moment.`
  }
}

const tools: Promise<Tool>[] = [
  tool({
    name: 'webSearch',
    description: 'Search the web for current or unknown information and get back a short list of result snippets. Use when you are unsure, need up-to-date facts, or the user asks you to look something up. It is fine not to call this when you already know the answer.',
    execute: executeWebSearch,
    parameters: webSearchParams,
  }),
]

export const webSearchTools = async () => Promise.all(tools)
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm exec vitest run apps/stage-tamagotchi/src/renderer/stores/tools/builtin/web-search.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Wire the tool always-on in `chat-sync.ts`**

In `airi/apps/stage-tamagotchi/src/renderer/stores/chat-sync.ts`, add the import next to the memory-tools import (~line 22):

```ts
import { webSearchTools } from './tools/builtin/web-search'
```

Then change the always-on base in `resolveTools` (~line 313-318) from:

```ts
    // memory(remember)는 toolset과 무관하게 매 턴 항상 제공한다.
    return async () => {
      const base = await memoryTools()
      const extra = (toolset && toolsetRegistry[toolset]) ? await toolsetRegistry[toolset]() : []
      return [...base, ...extra]
    }
```

to:

```ts
    // memory(remember)와 webSearch는 toolset과 무관하게 매 턴 항상 제공한다.
    return async () => {
      const [mem, search] = await Promise.all([memoryTools(), webSearchTools()])
      const extra = (toolset && toolsetRegistry[toolset]) ? await toolsetRegistry[toolset]() : []
      return [...mem, ...search, ...extra]
    }
```

- [ ] **Step 7: Run tool + memory tests + typecheck**

Run: `pnpm exec vitest run apps/stage-tamagotchi/src/renderer/stores/tools/builtin/web-search.test.ts apps/stage-tamagotchi/src/renderer/stores/tools/builtin/memory.test.ts`
Expected: PASS (6 + 4).
Run: `pnpm -F @proj-airi/stage-tamagotchi typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add airi/apps/stage-tamagotchi/src/renderer/web-search-io.ts airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/web-search.ts airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/web-search.test.ts airi/apps/stage-tamagotchi/src/renderer/stores/chat-sync.ts
git commit -m "feat(stage-tamagotchi): add always-on webSearch builtin tool"
```

---

## Task 4: Persona SEARCH guidance

**Files:**
- Modify: `airi/packages/stage-ui/src/constants/neru-persona.ts` (add a SEARCH block after the MEMORY block, before "Stay in character")
- Test: `airi/packages/stage-ui/src/constants/neru-persona.test.ts`

**Interfaces:**
- Consumes: nothing new. Modifies the `NERU_SYSTEM_PROMPT` string constant.
- Produces: `NERU_SYSTEM_PROMPT` now contains a SEARCH block.

- [ ] **Step 1: Write the failing test**

Add to `airi/packages/stage-ui/src/constants/neru-persona.test.ts` inside the `describe('neru system prompt', ...)` block:

```ts
  it('includes web-search guidance', () => {
    expect(NERU_SYSTEM_PROMPT).toMatch(/webSearch/)
    expect(NERU_SYSTEM_PROMPT).toMatch(/search the web|look .* up/i)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/constants/neru-persona.test.ts`
Expected: FAIL — the new assertion fails (no webSearch guidance yet).

- [ ] **Step 3: Add the SEARCH block to the persona**

In `airi/packages/stage-ui/src/constants/neru-persona.ts`, insert this block immediately after the `MEMORY:` block and before the final `Stay in character as neru at all times.` line:

```ts
MEMORY:
- You have a long-term memory. When you learn something durable and significant worth remembering across sessions — a fact about the user, a stated preference, ongoing context — call the remember tool to save it.
- Only save lasting, meaningful facts. Do NOT save small talk, transient mood, or things you already clearly know. It is completely fine to save nothing in a reply.
- The user cannot see the tool call; just keep talking naturally.

SEARCH:
- You can search the web with the webSearch tool. Use it when you are unsure, need current or specific facts (news, releases, prices, "what is X"), or the user asks you to look something up. Do NOT guess or make up facts you could look up.
- Keep searching rare and purposeful — do not search for small talk or things you already know. It is fine not to search at all in a reply.
- The tool returns short result snippets. Read them, then answer in your own words and briefly mention what you found. The user cannot see the tool call; just keep talking naturally. If search is unavailable, say so casually and move on.

Stay in character as neru at all times.`
```

(The block is inserted by replacing the existing `MEMORY:` ... `Stay in character as neru at all times.\`` region with the text above — the `MEMORY:` block is copied verbatim so nothing is lost.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/constants/neru-persona.test.ts`
Expected: PASS (all persona tests, including the new one).

- [ ] **Step 5: Typecheck**

Run: `pnpm -F @proj-airi/stage-ui typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add airi/packages/stage-ui/src/constants/neru-persona.ts airi/packages/stage-ui/src/constants/neru-persona.test.ts
git commit -m "feat(stage-ui): add webSearch guidance to neru persona"
```

---

## Task 5: SearXNG Docker Compose infra

**Files:**
- Create: `infra/searxng/docker-compose.yml`
- Create: `infra/searxng/settings.yml`
- Create: `infra/searxng/README.md`

**Interfaces:**
- Produces: a local SearXNG on `http://localhost:8888` with `format=json` enabled — the backend `NERU_SEARXNG_URL` points at. No code imports this; it is validated by running it.

- [ ] **Step 1: Create the compose file**

Create `infra/searxng/docker-compose.yml`:

```yaml
# neru 웹 검색 백엔드 — 자체 호스팅 SearXNG. 로컬에서만 접근(127.0.0.1:8888).
# 실행: docker compose -f infra/searxng/docker-compose.yml up -d
services:
  searxng:
    image: searxng/searxng:latest
    container_name: neru-searxng
    ports:
      - "127.0.0.1:8888:8080"
    volumes:
      - ./settings.yml:/etc/searxng/settings.yml:ro
    environment:
      - SEARXNG_BASE_URL=http://localhost:8888/
    restart: unless-stopped
```

- [ ] **Step 2: Create the SearXNG settings**

Create `infra/searxng/settings.yml`:

```yaml
# neru용 최소 SearXNG 설정 — JSON 출력 활성화가 핵심(webSearch 도구가 format=json으로 조회).
# secret_key는 로컬 전용이라 데모 값이지만, 공개 배포한다면 반드시 교체할 것.
use_default_settings: true

server:
  secret_key: "neru-local-searxng-change-me"
  bind_address: "0.0.0.0:8080"
  limiter: false
  image_proxy: false

search:
  # JSON은 기본으로 꺼져 있다 — 도구가 프로그램적으로 읽으려면 반드시 켜야 한다.
  formats:
    - html
    - json
```

- [ ] **Step 3: Create the README**

Create `infra/searxng/README.md`:

```markdown
# neru web search — SearXNG

Self-hosted [SearXNG](https://github.com/searxng/searxng) metasearch backend for neru's `webSearch` tool.

## Run

```bash
docker compose -f infra/searxng/docker-compose.yml up -d
```

Serves `http://localhost:8888` (bound to 127.0.0.1 only). Stop with `docker compose -f infra/searxng/docker-compose.yml down`.

## How neru uses it

neru's `webSearch` builtin tool (always-on) calls the main-process web-search service, which fetches `GET http://localhost:8888/search?q=...&format=json`. Override the URL with `NERU_SEARXNG_URL`.

Search is an **optional dependency** — if this container is not running, neru degrades gracefully ("I can't search right now") instead of crashing.

## Notes

- `settings.yml` enables the `json` output format (off by default) and sets a local `secret_key` — change it if you ever expose this beyond localhost.
- If Google rate-limits the instance (captchas), SearXNG still returns results from the other aggregated engines.
```

- [ ] **Step 4: Manual verification (documented — no unit test)**

Run:
```bash
docker compose -f infra/searxng/docker-compose.yml up -d
curl -s "http://localhost:8888/search?q=hello&format=json" | head -c 200
```
Expected: JSON beginning with `{"query":"hello"...` and a `results` array. If it returns HTML or a 403, the `json` format is not enabled — recheck `settings.yml`.

- [ ] **Step 5: Commit**

```bash
git add infra/searxng/
git commit -m "chore(infra): self-hosted SearXNG compose for neru web search"
```

---

## Manual verification (end-to-end, after all tasks)

1. `docker compose -f infra/searxng/docker-compose.yml up -d` and confirm the `curl` JSON probe above.
2. Launch neru (`pnpm -F @proj-airi/stage-tamagotchi dev`).
3. Ask neru (in Korean) something current/factual she'd need to look up (e.g. "오늘 환율 어때?" / "최신 뭐뭐 나왔어?"). Confirm she calls `webSearch` and answers from real snippets (English voice + `<ko>` subtitle).
4. Stop SearXNG (`docker compose ... down`) and ask again → neru should say she can't search right now, no crash.

## Notes for the final reviewer

- Non-blocking / accepted: search results are raw snippets (not LLM-summarized) by design; SearXNG reliability depends on upstream engines (occasional captchas), mitigated by aggregation.
- Forward-looking (out of scope now): when untrusted audience/chat input is later wired, a search query built from untrusted text + snippets injected into the prompt is a prompt-injection surface — same class as the deferred memory item. Not in scope for this text/operator-only build.
- The `webSearch` tool now runs on every turn (always-on) alongside `remember`; confirm the local LLM proxy handles two always-on tools without issue (the memory feature already validated proxy function-calling; this adds one more tool schema).
