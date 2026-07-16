# neru Long-term Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let neru record durable facts mid-conversation via a `remember` tool and recall them from an editable `MEMORY.md` file injected into its context each session.

**Architecture:** A `remember` builtin tool (tamagotchi renderer) calls the Electron main process (eventa IPC) to append a categorized bullet to `<userData>/neru-memory/MEMORY.md`; the section-aware append + the bounded recall rendering are pure functions in stage-ui; a `useMemoryStore` (stage-ui) holds the file text reactively; a runtime context provider (stage-ui) injects a bounded memory block at the orchestrator's existing insertion point every turn.

**Tech Stack:** Vue 3 · Pinia · Electron · `@moeru/eventa` (IPC) · `@xsai/tool` + `zod` (tools) · Vitest · `@proj-airi/core-agent` runtime.

**Spec:** `docs/superpowers/specs/2026-07-16-neru-long-term-memory-design.md`

## Global Constraints

- Storage is a single markdown file `<userData>/neru-memory/MEMORY.md`; it is the source of truth (no IndexedDB mirror).
- Categories are exactly `identity | preference | context | misc`.
- Builtin tools use **zod** (`z.object(...)`) for `parameters` and `tool()` from `@xsai/tool` — NOT valibot, and NO manual `toJsonSchema`/`normalizeNullableAnyOf` (matches existing `stores/tools/builtin/weather.ts`).
- Runtime context providers are **synchronous** `() => ContextMessage | null | undefined`; async file IO must be pre-loaded into `useMemoryStore` and read synchronously by the provider.
- The `remember` tool must be available on **every** neru turn (not gated behind a toolset).
- Package dependency direction: `stage-ui` (package) must NOT import from `apps/stage-tamagotchi` (app). IPC contracts and file IO live in the app; pure logic and the store live in stage-ui.
- Tests: stage-ui → `pnpm -F @proj-airi/stage-ui exec vitest run <path>`; tamagotchi → `pnpm -F @proj-airi/stage-tamagotchi exec vitest run <path>`; typecheck → `pnpm -F @proj-airi/<pkg> typecheck`; lint → `node node_modules/eslint/bin/eslint.js <file>` (run from `airi/`). Commit messages: Conventional Commits, English, gitmoji prohibited.
- Run all commands from `airi/`. The git root is the parent `neurosama-ai/` (airi is a plain subdirectory, not a submodule) — run `git add` from the repo root.

---

## File Structure

- **Create** `airi/packages/stage-ui/src/utils/memory-md.ts` — pure markdown helpers: section-aware append + dedup, bounded recall render.
- **Create** `airi/packages/stage-ui/src/utils/memory-md.test.ts` — unit tests for the above.
- **Modify** `airi/packages/stage-ui/package.json` — add a `./utils/*` subpath export (utils currently exposes only the `./utils` barrel; the `remember` tool imports `@proj-airi/stage-ui/utils/memory-md` across the package boundary, which needs the wildcard — mirrors the existing `./components/*`, `./composables/*`, `./constants/*`, `./libs/*` entries).
- **Create** `airi/packages/stage-ui/src/stores/modules/memory.ts` — `useMemoryStore` (reactive `memoryText`, `setMemoryText`, `hasMemory`).
- **Create** `airi/packages/stage-ui/src/stores/modules/memory.test.ts` — store unit tests.
- **Modify** `airi/packages/stage-ui/src/stores/modules/index.ts` — export the new module.
- **Modify** `airi/apps/stage-tamagotchi/src/shared/eventa/index.ts` — add memory read/write IPC contracts.
- **Create** `airi/apps/stage-tamagotchi/src/main/services/airi/memory/index.ts` — main-process file service (read/write/ensure).
- **Modify** `airi/apps/stage-tamagotchi/src/main/windows/main/rpc/index.electron.ts` — register the memory service on the main window context.
- **Create** `airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/memory.ts` — the `remember` tool.
- **Create** `airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/memory.test.ts` — tool unit tests.
- **Create** `airi/apps/stage-tamagotchi/src/renderer/memory-init.ts` — startup load of MEMORY.md into the store.
- **Modify** `airi/apps/stage-tamagotchi/src/renderer/stores/chat-sync.ts` — always include memory tools in `resolveTools`.
- **Modify** the renderer bootstrap where `neruPreseed()` is called — call `initMemory()`.
- **Modify** `airi/packages/stage-ui/src/constants/neru-persona.ts` — add the "when to remember" guidance.
- **Create** `airi/packages/stage-ui/src/stores/chat/context-providers/memory.ts` — `createMemoryContext` recall provider.
- **Create** `airi/packages/stage-ui/src/stores/chat/context-providers/memory.test.ts` — provider unit tests.
- **Modify** `airi/packages/stage-ui/src/stores/chat/context-providers/index.ts` — export the provider.
- **Modify** `airi/packages/stage-ui/src/stores/chat.ts:180-182` — add `createMemoryContext` to `runtimeContextProviders`.

---

## Task 1: Pure MEMORY.md markdown helpers

**Files:**
- Create: `airi/packages/stage-ui/src/utils/memory-md.ts`
- Test: `airi/packages/stage-ui/src/utils/memory-md.test.ts`

**Interfaces:**
- Produces:
  - `type MemoryCategory = 'identity' | 'preference' | 'context' | 'misc'`
  - `appendMemoryToMarkdown(existing: string, entry: { category: MemoryCategory, text: string }, date: string): string`
  - `renderMemoryContext(memoryText: string, budgetChars: number): string`

- [ ] **Step 1: Write the failing test**

Create `airi/packages/stage-ui/src/utils/memory-md.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { appendMemoryToMarkdown, renderMemoryContext } from './memory-md'

describe('appendMemoryToMarkdown', () => {
  it('creates the file scaffold and section when empty', () => {
    const out = appendMemoryToMarkdown('', { category: 'preference', text: 'Likes Factorio' }, '2026-07-16')
    expect(out).toContain('# neru\'s memory')
    expect(out).toContain('## Preferences')
    expect(out).toContain('- Likes Factorio (2026-07-16)')
  })

  it('appends under the existing section, not a duplicate section', () => {
    const existing = '# neru\'s memory\n\n## Preferences\n- Likes Factorio (2026-07-16)\n'
    const out = appendMemoryToMarkdown(existing, { category: 'preference', text: 'Streams Tuesdays' }, '2026-07-16')
    expect(out.match(/## Preferences/g)).toHaveLength(1)
    expect(out).toContain('- Likes Factorio (2026-07-16)')
    expect(out).toContain('- Streams Tuesdays (2026-07-16)')
  })

  it('skips an exact duplicate bullet (case-insensitive, trimmed) in the same section', () => {
    const existing = '# neru\'s memory\n\n## Identity\n- The user builds neru (2026-07-16)\n'
    const out = appendMemoryToMarkdown(existing, { category: 'identity', text: '  the user builds neru  ' }, '2026-07-17')
    expect(out.match(/- .*builds neru/gi)).toHaveLength(1)
  })

  it('routes each category to its own section header', () => {
    let out = appendMemoryToMarkdown('', { category: 'identity', text: 'a' }, '2026-07-16')
    out = appendMemoryToMarkdown(out, { category: 'context', text: 'b' }, '2026-07-16')
    out = appendMemoryToMarkdown(out, { category: 'misc', text: 'c' }, '2026-07-16')
    expect(out).toContain('## Identity')
    expect(out).toContain('## Context')
    expect(out).toContain('## Misc')
  })
})

describe('renderMemoryContext', () => {
  it('returns empty string for empty/whitespace memory', () => {
    expect(renderMemoryContext('', 4000)).toBe('')
    expect(renderMemoryContext('   \n  ', 4000)).toBe('')
  })

  it('wraps memory text in a recall header when present', () => {
    const out = renderMemoryContext('# neru\'s memory\n\n## Identity\n- x (2026-07-16)\n', 4000)
    expect(out).toContain('What you remember about the user and this world')
    expect(out).toContain('- x (2026-07-16)')
  })

  it('truncates to the budget and marks truncation', () => {
    const big = '# neru\'s memory\n\n## Misc\n' + Array.from({ length: 500 }, (_, i) => `- fact ${i}`).join('\n')
    const out = renderMemoryContext(big, 200)
    expect(out.length).toBeLessThanOrEqual(200 + 80) // header + truncation note allowance
    expect(out).toContain('(memory truncated)')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/utils/memory-md.test.ts`
Expected: FAIL — `memory-md` module / functions not found.

- [ ] **Step 3: Write the implementation**

Create `airi/packages/stage-ui/src/utils/memory-md.ts`:

```ts
// neru 장기기억 MEMORY.md 마크다운을 다루는 순수 헬퍼 (섹션별 append·중복제거·회상 렌더링)

export type MemoryCategory = 'identity' | 'preference' | 'context' | 'misc'

// 카테고리 → 섹션 헤더 표기. 파일은 이 순서로 섹션을 유지한다.
const SECTION_TITLE: Record<MemoryCategory, string> = {
  identity: 'Identity',
  preference: 'Preferences',
  context: 'Context',
  misc: 'Misc',
}

const FILE_HEADER = '# neru\'s memory'

function bulletBody(line: string): string {
  // "- text (date)" 에서 앞의 "- " 와 뒤의 " (date)" 를 벗겨 본문만 비교용으로 추출.
  const withoutDash = line.replace(/^\s*-\s*/, '')
  return withoutDash.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase()
}

/**
 * MEMORY.md 텍스트에 사실 하나를 append 한다.
 * - 파일/헤더/섹션이 없으면 만든다.
 * - 같은 섹션에 (대소문자·공백 무시) 동일 본문 불릿이 있으면 건너뛴다.
 */
export function appendMemoryToMarkdown(
  existing: string,
  entry: { category: MemoryCategory, text: string },
  date: string,
): string {
  const title = SECTION_TITLE[entry.category]
  const newBody = entry.text.trim().toLowerCase()
  const newBullet = `- ${entry.text.trim()} (${date})`

  const base = existing.trim().length > 0 ? existing.replace(/\s*$/, '') : FILE_HEADER
  const lines = base.split('\n')

  const sectionHeader = `## ${title}`
  const headerIdx = lines.findIndex(l => l.trim() === sectionHeader)

  if (headerIdx === -1) {
    // 섹션이 없으면 파일 끝에 새 섹션 + 불릿을 붙인다.
    return `${lines.join('\n')}\n\n${sectionHeader}\n${newBullet}\n`
  }

  // 섹션 범위(다음 '## ' 헤더 전까지)에서 중복 본문 확인.
  let end = headerIdx + 1
  while (end < lines.length && !lines[end].startsWith('## ')) end++
  const sectionLines = lines.slice(headerIdx + 1, end)
  const duplicate = sectionLines.some(l => l.trim().startsWith('-') && bulletBody(l) === newBody)
  if (duplicate)
    return `${lines.join('\n')}\n`

  // 섹션 마지막 불릿 뒤에 삽입.
  lines.splice(end, 0, newBullet)
  return `${lines.join('\n')}\n`
}

/**
 * MEMORY.md 텍스트를 회상용 컨텍스트 블록으로 렌더한다.
 * 비어 있으면 '' 를 반환하고(주입 no-op), budgetChars 초과 시 잘라 표시한다.
 */
export function renderMemoryContext(memoryText: string, budgetChars: number): string {
  const trimmed = memoryText.trim()
  if (trimmed.length === 0)
    return ''

  const header = 'What you remember about the user and this world (from past sessions):'
  let body = trimmed
  if (body.length > budgetChars)
    body = `${body.slice(0, budgetChars)}\n(memory truncated)`

  return `${header}\n${body}`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/utils/memory-md.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Add the `./utils/*` subpath export**

In `airi/packages/stage-ui/package.json`, in the `exports` object, add a `./utils/*` entry next to the existing `./utils` entry (so `@proj-airi/stage-ui/utils/memory-md` resolves for Task 4's cross-package import):

```jsonc
"./utils/*": "./src/utils/*.ts",
"./utils": "./src/utils/index.ts",
```

Verify resolution: `node -e "console.log(require('./packages/stage-ui/package.json').exports['./utils/*'])"` prints `./src/utils/*.ts`.

- [ ] **Step 6: Lint + commit**

Run: `node node_modules/eslint/bin/eslint.js packages/stage-ui/src/utils/memory-md.ts packages/stage-ui/src/utils/memory-md.test.ts`
Then (from repo root):

```bash
git add airi/packages/stage-ui/src/utils/memory-md.ts airi/packages/stage-ui/src/utils/memory-md.test.ts airi/packages/stage-ui/package.json
git commit -m "feat(stage-ui): pure MEMORY.md append/dedup + recall render helpers"
```

---

## Task 2: `useMemoryStore` (reactive memory text)

**Files:**
- Create: `airi/packages/stage-ui/src/stores/modules/memory.ts`
- Test: `airi/packages/stage-ui/src/stores/modules/memory.test.ts`
- Modify: `airi/packages/stage-ui/src/stores/modules/index.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `useMemoryStore()` returning `{ memoryText: Ref<string>, hasMemory: ComputedRef<boolean>, setMemoryText(text: string): void }`.

- [ ] **Step 1: Write the failing test**

Create `airi/packages/stage-ui/src/stores/modules/memory.test.ts`:

```ts
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useMemoryStore } from './memory'

describe('useMemoryStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('starts empty', () => {
    const store = useMemoryStore()
    expect(store.memoryText).toBe('')
    expect(store.hasMemory).toBe(false)
  })

  it('setMemoryText updates text and hasMemory', () => {
    const store = useMemoryStore()
    store.setMemoryText('# neru\'s memory\n\n## Misc\n- x (2026-07-16)\n')
    expect(store.memoryText).toContain('- x (2026-07-16)')
    expect(store.hasMemory).toBe(true)
  })

  it('hasMemory is false for whitespace-only text', () => {
    const store = useMemoryStore()
    store.setMemoryText('   \n ')
    expect(store.hasMemory).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/stores/modules/memory.test.ts`
Expected: FAIL — `./memory` not found.

- [ ] **Step 3: Write the implementation**

Create `airi/packages/stage-ui/src/stores/modules/memory.ts`:

```ts
// neru 장기기억(MEMORY.md) 텍스트를 반응형으로 보관하는 스토어.
// 파일 IO는 하지 않는다 — tamagotchi 렌더러(IPC 소유)가 로드/저장 후 setMemoryText로 채운다.
// 회상 context provider(동기)가 이 memoryText를 읽는다.
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const useMemoryStore = defineStore('memory', () => {
  const memoryText = ref('')
  const hasMemory = computed(() => memoryText.value.trim().length > 0)

  function setMemoryText(text: string) {
    memoryText.value = text
  }

  return { memoryText, hasMemory, setMemoryText }
})
```

- [ ] **Step 4: Register the module**

Modify `airi/packages/stage-ui/src/stores/modules/index.ts` — add the export in alphabetical position (after `./hearing`, before `./speech`):

```ts
export * from './hearing'
export * from './memory'
export * from './speech'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/stores/modules/memory.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint + commit**

Run: `node node_modules/eslint/bin/eslint.js packages/stage-ui/src/stores/modules/memory.ts packages/stage-ui/src/stores/modules/memory.test.ts packages/stage-ui/src/stores/modules/index.ts`
Then (from repo root):

```bash
git add airi/packages/stage-ui/src/stores/modules/memory.ts airi/packages/stage-ui/src/stores/modules/memory.test.ts airi/packages/stage-ui/src/stores/modules/index.ts
git commit -m "feat(stage-ui): add useMemoryStore reactive memory-text holder"
```

---

## Task 3: Main-process MEMORY.md file service + IPC contracts

**Files:**
- Modify: `airi/apps/stage-tamagotchi/src/shared/eventa/index.ts`
- Create: `airi/apps/stage-tamagotchi/src/main/services/airi/memory/index.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/windows/main/rpc/index.electron.ts`

**Interfaces:**
- Produces (shared contracts):
  - `electronMemoryReadText: InvokeEventa<{ path: string, text: string }>`
  - `electronMemoryWriteText: InvokeEventa<{ path: string, text: string }, { text: string }>`
- Produces (main): `createMemoryService(params: { context })` registering handlers for the two contracts. Read returns `{ path, text }` (empty string if the file was just created); write persists `payload.text` verbatim and returns `{ path, text }`.

**Verification note:** main-process `fs` handlers are verified by typecheck + lint + the manual protocol (Task 6), not a unit test — the append/dedup logic they rely on is already unit-tested in Task 1. This mirrors how the barge-in Stage wiring was verified.

- [ ] **Step 1: Add the IPC contracts**

In `airi/apps/stage-tamagotchi/src/shared/eventa/index.ts`, near the other `electron*` invoke contracts (e.g. next to `electronMcpReadConfigText`), add:

```ts
export interface ElectronMemoryText { path: string, text: string }

export const electronMemoryReadText = defineInvokeEventa<ElectronMemoryText>('eventa:invoke:electron:memory:read-text')
export const electronMemoryWriteText = defineInvokeEventa<ElectronMemoryText, { text: string }>('eventa:invoke:electron:memory:write-text')
```

(`defineInvokeEventa` is already imported in this file.)

- [ ] **Step 2: Implement the main service**

> Before writing, open the existing `apps/stage-tamagotchi/src/main/services/airi/mcp-servers/index.ts` and copy its service-factory signature verbatim — specifically the exact type of the `params.context` argument and the import path for it (the code below shows the intended shape, but match the real `createContext`/context type used by the sibling service rather than the illustrative import here).

Create `airi/apps/stage-tamagotchi/src/main/services/airi/memory/index.ts`:

```ts
// neru 장기기억 파일(MEMORY.md)의 메인 프로세스 IO 서비스 — 렌더러의 read/write IPC를 처리한다.
import type { createContext } from '@moeru/eventa/adapters/electron/main'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { defineInvokeHandler } from '@moeru/eventa'
import { app } from 'electron'
import { electronMemoryReadText, electronMemoryWriteText } from '../../../../shared/eventa'

function memoryFilePath(): string {
  return join(app.getPath('userData'), 'neru-memory', 'MEMORY.md')
}

// 파일이 없으면 디렉터리와 빈 파일을 만든다. 반환은 파일 경로.
async function ensureFile(): Promise<string> {
  const path = memoryFilePath()
  await mkdir(dirname(path), { recursive: true })
  try {
    await readFile(path, 'utf-8')
  }
  catch {
    await writeFile(path, '')
  }
  return path
}

export function createMemoryService(params: { context: ReturnType<typeof createContext>['context'] }) {
  // 쓰기를 직렬화한다 — 한 응답에서 remember가 여러 번 호출돼도 파일이 깨지지 않게.
  let writeChain: Promise<unknown> = Promise.resolve()

  defineInvokeHandler(params.context, electronMemoryReadText, async () => {
    const path = await ensureFile()
    const text = await readFile(path, 'utf-8')
    return { path, text }
  })

  defineInvokeHandler(params.context, electronMemoryWriteText, async (payload) => {
    const run = async () => {
      const path = await ensureFile()
      await writeFile(path, payload.text)
      return { path, text: payload.text }
    }
    writeChain = writeChain.then(run, run)
    return writeChain as Promise<{ path: string, text: string }>
  })
}
```

- [ ] **Step 3: Register the service on the main window context**

In `airi/apps/stage-tamagotchi/src/main/windows/main/rpc/index.electron.ts`, import and register alongside the existing `createXService({ context, ... })` calls (mirror how `createMcpServersService` is wired):

```ts
import { createMemoryService } from '../../../services/airi/memory'
// ...inside the function, after the shared invokes are set up and `context` exists:
createMemoryService({ context })
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm -F @proj-airi/stage-tamagotchi typecheck`
Expected: exit 0.
Run: `node node_modules/eslint/bin/eslint.js apps/stage-tamagotchi/src/main/services/airi/memory/index.ts apps/stage-tamagotchi/src/shared/eventa/index.ts apps/stage-tamagotchi/src/main/windows/main/rpc/index.electron.ts`
Expected: clean.

- [ ] **Step 5: Commit**

From repo root:

```bash
git add airi/apps/stage-tamagotchi/src/shared/eventa/index.ts airi/apps/stage-tamagotchi/src/main/services/airi/memory/index.ts airi/apps/stage-tamagotchi/src/main/windows/main/rpc/index.electron.ts
git commit -m "feat(stage-tamagotchi): main-process MEMORY.md read/write IPC service"
```

---

## Task 4: `remember` tool + always-on wiring + startup load + persona guidance

**Files:**
- Create: `airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/memory.ts`
- Test: `airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/memory.test.ts`
- Create: `airi/apps/stage-tamagotchi/src/renderer/memory-init.ts`
- Modify: `airi/apps/stage-tamagotchi/src/renderer/stores/chat-sync.ts`
- Modify: the renderer bootstrap where `neruPreseed()` is called
- Modify: `airi/packages/stage-ui/src/constants/neru-persona.ts`

**Interfaces:**
- Consumes: `appendMemoryToMarkdown` (Task 1), `useMemoryStore` (Task 2), `electronMemoryReadText` / `electronMemoryWriteText` (Task 3).
- Produces: `memoryTools: () => Promise<Tool[]>` (the `remember` tool); `initMemory(): Promise<void>` (startup load).

- [ ] **Step 1: Write the failing test**

Create `airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/memory.test.ts`:

```ts
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// NOTICE:
// electron-vueuse의 IPC invoke는 window.electron.ipcRenderer에 의존한다.
// 유닛 테스트에서는 실제 IPC 대신 read/write invoke를 스텁으로 주입해 도구 로직만 검증한다.
const reads: string[] = []
const writes: string[] = []
vi.mock('../../../memory-io', () => ({
  readMemoryText: vi.fn(async () => reads.shift() ?? ''),
  writeMemoryText: vi.fn(async (text: string) => { writes.push(text) }),
}))

import { useMemoryStore } from '@proj-airi/stage-ui/stores/modules/memory'
import { executeRemember } from './memory'

describe('remember tool', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    reads.length = 0
    writes.length = 0
  })

  it('appends a valid fact and updates the store', async () => {
    reads.push('') // current file empty
    const result = await executeRemember({ category: 'preference', text: 'Likes Factorio' })
    expect(result).toBe('Saved.')
    expect(writes[0]).toContain('## Preferences')
    expect(writes[0]).toContain('- Likes Factorio')
    expect(useMemoryStore().memoryText).toContain('- Likes Factorio')
  })

  it('rejects an unknown category without writing', async () => {
    const result = await executeRemember({ category: 'nope' as any, text: 'x' })
    expect(result.toLowerCase()).toContain('error')
    expect(writes).toHaveLength(0)
  })

  it('rejects empty text without writing', async () => {
    const result = await executeRemember({ category: 'misc', text: '   ' })
    expect(result.toLowerCase()).toContain('error')
    expect(writes).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @proj-airi/stage-tamagotchi exec vitest run src/renderer/stores/tools/builtin/memory.test.ts`
Expected: FAIL — `./memory` and `../../../memory-io` not found.

- [ ] **Step 3: Implement the IPC wrapper**

Create `airi/apps/stage-tamagotchi/src/renderer/memory-io.ts`:

```ts
// neru MEMORY.md 파일 IO를 렌더러에서 IPC로 감싼 얇은 래퍼 (도구·startup가 공유, 테스트에서 모킹).
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { electronMemoryReadText, electronMemoryWriteText } from '../shared/eventa'

export async function readMemoryText(): Promise<string> {
  const invoke = useElectronEventaInvoke(electronMemoryReadText)
  const res = await invoke()
  return res.text
}

export async function writeMemoryText(text: string): Promise<void> {
  const invoke = useElectronEventaInvoke(electronMemoryWriteText)
  await invoke({ text })
}
```

- [ ] **Step 4: Implement the tool**

Create `airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/memory.ts`:

```ts
// neru가 대화 중 기억할 만한 사실을 MEMORY.md에 기록하는 remember 도구.
import type { Tool } from '@xsai/shared-chat'
import type { MemoryCategory } from '@proj-airi/stage-ui/utils/memory-md'
import { useMemoryStore } from '@proj-airi/stage-ui/stores/modules/memory'
import { appendMemoryToMarkdown } from '@proj-airi/stage-ui/utils/memory-md'
import { tool } from '@xsai/tool'
import { z } from 'zod'
import { readMemoryText, writeMemoryText } from '../../../memory-io'

const CATEGORIES = ['identity', 'preference', 'context', 'misc'] as const

const rememberParams = z.object({
  category: z.enum(CATEGORIES).describe('identity = who the user is; preference = likes/how they want things; context = ongoing work/situation; misc = anything else durable'),
  text: z.string().describe('The durable fact to remember, phrased as a short standalone sentence.'),
})

// 도구 로직 본체 — 테스트가 직접 부른다(IPC 래퍼는 memory-io에서 모킹).
export async function executeRemember(input: { category: MemoryCategory, text: string }): Promise<string> {
  if (!CATEGORIES.includes(input.category))
    return `error: unknown category "${input.category}"`
  if (!input.text || input.text.trim().length === 0)
    return 'error: empty memory text'

  try {
    const existing = await readMemoryText()
    const date = new Date().toISOString().slice(0, 10)
    const next = appendMemoryToMarkdown(existing, { category: input.category, text: input.text }, date)
    await writeMemoryText(next)
    useMemoryStore().setMemoryText(next)
    return 'Saved.'
  }
  catch (error) {
    return `error: ${error instanceof Error ? error.message : String(error)}`
  }
}

const tools: Promise<Tool>[] = [
  tool({
    name: 'remember',
    description: 'Save a durable, significant fact about the user or the ongoing world to long-term memory so you recall it in future sessions. Use ONLY for lasting facts (identity, preferences, ongoing context) — never for small talk or transient state. It is fine to not call this at all in a turn.',
    execute: executeRemember,
    parameters: rememberParams,
  }),
]

export const memoryTools = async () => Promise.all(tools)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -F @proj-airi/stage-tamagotchi exec vitest run src/renderer/stores/tools/builtin/memory.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire the tool as always-on in `resolveTools`**

In `airi/apps/stage-tamagotchi/src/renderer/stores/chat-sync.ts`, import the tool factory (next to the other builtin imports, ~lines 21-23):

```ts
import { memoryTools } from './tools/builtin/memory'
```

Replace the `resolveTools` function (currently ~lines 296-317) so memory tools are ALWAYS included, merged with any toolset tools:

```ts
function resolveTools(toolset?: ToolsetId) {
  const toolsetRegistry: Record<string, () => Promise<any[]>> = {
    widgets: async () => {
      const [w, we] = await Promise.all([widgetsTools(), weatherTools()])
      return [...w, ...we]
    },
    artistry: async () => {
      const [ai, wi, we] = await Promise.all([imageJournalTools(), widgetsTools(), weatherTools()])
      return [...ai, ...wi, ...we]
    },
  }
  // memory(remember)는 toolset과 무관하게 매 턴 항상 제공한다.
  return async () => {
    const base = await memoryTools()
    const extra = (toolset && toolsetRegistry[toolset]) ? await toolsetRegistry[toolset]() : []
    return [...base, ...extra]
  }
}
```

- [ ] **Step 7: Implement + wire the startup load**

Create `airi/apps/stage-tamagotchi/src/renderer/memory-init.ts`:

```ts
// 앱 시작 시 MEMORY.md를 읽어 useMemoryStore에 채운다 — 회상 provider(동기)가 즉시 읽을 수 있도록.
import { useMemoryStore } from '@proj-airi/stage-ui/stores/modules/memory'
import { readMemoryText } from './memory-io'

export async function initMemory(): Promise<void> {
  try {
    const text = await readMemoryText()
    useMemoryStore().setMemoryText(text)
  }
  catch {
    // 파일이 없거나 IPC 실패 시 빈 상태 유지 — 회상은 no-op, 첫 remember가 파일을 만든다.
  }
}
```

Then, in the renderer bootstrap file where `neruPreseed()` is called (grep for `neruPreseed(` under `apps/stage-tamagotchi/src/renderer/`), import and invoke `initMemory()` immediately after the `neruPreseed()` call:

```ts
import { initMemory } from './memory-init' // adjust relative path to the bootstrap file's location
// after neruPreseed():
void initMemory()
```

- [ ] **Step 8: Add the persona guidance**

In `airi/packages/stage-ui/src/constants/neru-persona.ts`, add a MEMORY section to `NERU_SYSTEM_PROMPT` right after the EMOTION TOKENS block (before "Stay in character"):

```
MEMORY:
- You have a long-term memory. When you learn something durable and significant worth remembering across sessions — a fact about the user, a stated preference, ongoing context — call the remember tool to save it.
- Only save lasting, meaningful facts. Do NOT save small talk, transient mood, or things you already clearly know. It is completely fine to save nothing in a reply.
- The user cannot see the tool call; just keep talking naturally.
```

- [ ] **Step 9: Typecheck, lint, commit**

Run: `pnpm -F @proj-airi/core-agent build` then `pnpm -F @proj-airi/stage-tamagotchi typecheck`
Expected: exit 0.
Run: `node node_modules/eslint/bin/eslint.js apps/stage-tamagotchi/src/renderer/stores/tools/builtin/memory.ts apps/stage-tamagotchi/src/renderer/memory-io.ts apps/stage-tamagotchi/src/renderer/memory-init.ts apps/stage-tamagotchi/src/renderer/stores/chat-sync.ts packages/stage-ui/src/constants/neru-persona.ts`
Expected: clean.
Then (from repo root):

```bash
git add airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/memory.ts airi/apps/stage-tamagotchi/src/renderer/stores/tools/builtin/memory.test.ts airi/apps/stage-tamagotchi/src/renderer/memory-io.ts airi/apps/stage-tamagotchi/src/renderer/memory-init.ts airi/apps/stage-tamagotchi/src/renderer/stores/chat-sync.ts airi/packages/stage-ui/src/constants/neru-persona.ts
git commit -m "feat: add remember tool (always-on), startup load, and persona memory guidance"
```

---

## Task 5: Recall context provider

**Files:**
- Create: `airi/packages/stage-ui/src/stores/chat/context-providers/memory.ts`
- Test: `airi/packages/stage-ui/src/stores/chat/context-providers/memory.test.ts`
- Modify: `airi/packages/stage-ui/src/stores/chat/context-providers/index.ts`
- Modify: `airi/packages/stage-ui/src/stores/chat.ts:180-182`

**Interfaces:**
- Consumes: `useMemoryStore` (Task 2), `renderMemoryContext` (Task 1).
- Produces: `createMemoryContext(): ContextMessage | null` (synchronous).

- [ ] **Step 1: Write the failing test**

Create `airi/packages/stage-ui/src/stores/chat/context-providers/memory.test.ts`:

```ts
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useMemoryStore } from '../../modules/memory'
import { createMemoryContext } from './memory'

describe('createMemoryContext', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('returns null when memory is empty', () => {
    expect(createMemoryContext()).toBeNull()
  })

  it('returns a ContextMessage with the rendered memory when present', () => {
    useMemoryStore().setMemoryText('# neru\'s memory\n\n## Identity\n- The user builds neru (2026-07-16)\n')
    const ctx = createMemoryContext()
    expect(ctx).not.toBeNull()
    expect(ctx!.contextId).toBe('system:neru-memory')
    expect(ctx!.text).toContain('What you remember about the user')
    expect(ctx!.text).toContain('- The user builds neru (2026-07-16)')
    expect(typeof ctx!.id).toBe('string')
    expect(typeof ctx!.createdAt).toBe('number')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/stores/chat/context-providers/memory.test.ts`
Expected: FAIL — `./memory` not found.

- [ ] **Step 3: Write the implementation**

Create `airi/packages/stage-ui/src/stores/chat/context-providers/memory.ts` (mirrors `minecraft.ts`):

```ts
// neru 장기기억(MEMORY.md)을 매 턴 프롬프트에 주입하는 회상 context provider (동기).
import type { ContextMessage } from '../../../types/chat'
import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'
import { useMemoryStore } from '../../modules/memory'
import { renderMemoryContext } from '../../../utils/memory-md'

const MEMORY_CONTEXT_ID = 'system:neru-memory'
// 주입 상한(문자). MEMORY.md가 커져도 프롬프트를 넘치지 않게 자른다.
const MEMORY_BUDGET_CHARS = 4000

export function createMemoryContext(): ContextMessage | null {
  const memoryStore = useMemoryStore()
  if (!memoryStore.hasMemory)
    return null

  const text = renderMemoryContext(memoryStore.memoryText, MEMORY_BUDGET_CHARS)
  if (text.length === 0)
    return null

  return {
    id: nanoid(),
    contextId: MEMORY_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text,
    createdAt: Date.now(),
  }
}
```

- [ ] **Step 4: Export + register the provider**

Modify `airi/packages/stage-ui/src/stores/chat/context-providers/index.ts` — add:

```ts
export { createMemoryContext } from './memory'
```

Modify `airi/packages/stage-ui/src/stores/chat.ts` — import `createMemoryContext` from `./chat/context-providers` (alongside the existing `createMinecraftContext` import) and add it to the `runtimeContextProviders` array (~lines 180-182):

```ts
runtimeContextProviders: [
  createMinecraftContext,
  createMemoryContext,
],
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/stores/chat/context-providers/memory.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `pnpm -F @proj-airi/stage-ui typecheck`
Expected: exit 0.
Run: `node node_modules/eslint/bin/eslint.js packages/stage-ui/src/stores/chat/context-providers/memory.ts packages/stage-ui/src/stores/chat/context-providers/memory.test.ts packages/stage-ui/src/stores/chat/context-providers/index.ts packages/stage-ui/src/stores/chat.ts`
Expected: clean.
Then (from repo root):

```bash
git add airi/packages/stage-ui/src/stores/chat/context-providers/memory.ts airi/packages/stage-ui/src/stores/chat/context-providers/memory.test.ts airi/packages/stage-ui/src/stores/chat/context-providers/index.ts airi/packages/stage-ui/src/stores/chat.ts
git commit -m "feat(stage-ui): inject MEMORY.md recall via runtime context provider"
```

---

## Manual verification (after all tasks, with the app running)

1. Launch the app (`pnpm desktop` from `airi/`). Type to neru something durable, e.g. "참고로 내 최애 게임은 Factorio야."
2. Open `<userData>/neru-memory/MEMORY.md` — confirm a `- ...Factorio... (YYYY-MM-DD)` bullet appears under `## Preferences` (or a sensible category).
3. Confirm nothing about the tool call leaked into neru's spoken reply or the Korean subtitle.
4. Restart the app; in a new session ask "내 최애 게임이 뭐게?" — neru should recall Factorio.
5. Hand-edit the file (add a bullet), restart, confirm neru reflects the edit.

## Post-implementation

- Run the full memory suites: `pnpm -F @proj-airi/stage-ui exec vitest run src/utils/memory-md.test.ts src/stores/modules/memory.test.ts src/stores/chat/context-providers/memory.test.ts` and `pnpm -F @proj-airi/stage-tamagotchi exec vitest run src/renderer/stores/tools/builtin/memory.test.ts`.
- Final whole-branch review, then human merge (do NOT auto-merge; never touch the proxy on :3456 or the gateway on :3457).
