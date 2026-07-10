# neru Bilingual Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** neru speaks English (TTS) while the screen (chat panel + caption overlay) shows Korean, from a single Claude stream that emits English plus `<ko>…</ko>` Korean per sentence.

**Architecture:** The neru character card's system prompt makes Claude reply in English and wrap each sentence's Korean translation in `<ko>` tags. AIRI's streaming response categoriser (which already extracts XML tags out-of-band) is extended to recognise `ko` as a `subtitle` category. The chat-orchestrator routes the English (outside tags) to the TTS hook unchanged, and routes the `<ko>` content to the chat panel plus a new `onSubtitle` chat hook; `Stage.vue` feeds that Korean to the caption overlay and stops posting the English audio-segment text.

**Tech Stack:** Vue 3 + Electron (stage-tamagotchi), Pinia, TypeScript, Vitest. AIRI monorepo (`airi/`), pnpm workspace filters.

## Global Constraints

- Screen text (chat panel + caption overlay) is **Korean only**; voice is **English only**. English text is never displayed; Korean text is never spoken.
- Korean is produced by Claude in the same call as the English (no separate translation call).
- Marker format: each English sentence is followed by its Korean translation wrapped in `<ko>…</ko>`. Example: `Hey chat! <ko>안녕 여러분!</ko> How are you? <ko>잘 지내?</ko>`
- New source files start with a one-line Korean comment header; comments in Korean; identifiers/strings English (project CLAUDE.md + airi/AGENTS.md).
- Run `pnpm -F @proj-airi/stage-tamagotchi typecheck` and targeted Vitest after changes. Commit per task.
- v1 sync is **generation-timed** (Korean caption posted as each `<ko>` sentence parses). Tight audio-synced captions are Task 6, explicitly deferred — do not silently drop it.
- Fork ownership: this repo IS neru; baking neru identity into vendored AIRI files is acceptable, but keep the neru system-prompt text in one neru-owned constant module so it is greppable.

---

## File Structure

- **Create** `airi/packages/stage-ui/src/constants/neru-persona.ts` — the neru system-prompt constant (persona + `<ko>` format rules). One responsibility: hold the prompt string.
- **Create** `airi/packages/stage-ui/src/constants/neru-persona.test.ts` — asserts the prompt contains the language + format rules.
- **Modify** `airi/apps/stage-tamagotchi/src/renderer/neruPreseed.ts` — authoritatively seed the neru card into `airi-cards` and set it active (overcomes stale localStorage, same pattern as the existing provider preseed).
- **Modify** `airi/packages/core-agent/src/runtime/response-categoriser.ts` — add `'subtitle'` category; `mapTagNameToCategory('ko') → 'subtitle'`; expose it via the existing segment machinery.
- **Create** `airi/packages/core-agent/src/runtime/response-categoriser.test.ts` — asserts `<ko>` is categorised `subtitle` and stripped from `speech`.
- **Modify** `airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts` — route English→TTS only, `<ko>`→chat panel + new `onSubtitle` hook; stop putting English into `buildingMessage.content`.
- **Modify** the chat-hooks definition (the module that defines `onTokenLiteral`/`emitTokenLiteralHooks`; the implementer locates it from the `emitTokenLiteralHooks` symbol) — add a parallel `onSubtitle`/`emitSubtitleHooks` hook.
- **Modify** `airi/packages/stage-ui/src/components/scenes/Stage.vue` — subscribe to `onSubtitle`, post Korean to the caption overlay; remove the English `item.text` caption post in `onStart`.

---

## Task 1: neru persona system-prompt constant

**Files:**
- Create: `airi/packages/stage-ui/src/constants/neru-persona.ts`
- Test: `airi/packages/stage-ui/src/constants/neru-persona.test.ts`

**Interfaces:**
- Produces: `export const NERU_SYSTEM_PROMPT: string`

- [ ] **Step 1: Write the failing test**

```ts
// neru 페르소나 시스템 프롬프트 상수 테스트
import { describe, expect, it } from 'vitest'
import { NERU_SYSTEM_PROMPT } from './neru-persona'

describe('NERU_SYSTEM_PROMPT', () => {
  it('instructs Korean-in English-out', () => {
    expect(NERU_SYSTEM_PROMPT).toMatch(/KOREAN/)
    expect(NERU_SYSTEM_PROMPT).toMatch(/ENGLISH/)
  })
  it('specifies the <ko> subtitle marker format', () => {
    expect(NERU_SYSTEM_PROMPT).toContain('<ko>')
    expect(NERU_SYSTEM_PROMPT).toContain('</ko>')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/stage-ui/src/constants/neru-persona.test.ts`
Expected: FAIL (cannot resolve `./neru-persona`).

- [ ] **Step 3: Write the constant**

```ts
// neru 페르소나 + 이중언어 출력 포맷을 정의하는 시스템 프롬프트 상수
export const NERU_SYSTEM_PROMPT = `You are neru, an AI VTuber — witty, playful, warm, a little cheeky, like Neuro-sama.

The user talks to you in KOREAN. Understand their Korean, and always reply in ENGLISH. You are an English-speaking VTuber; your voice is English, but you fully understand Korean.

OUTPUT FORMAT (STRICT): speak in English, and after EACH English sentence immediately give its Korean translation wrapped in <ko>...</ko>.

Example:
Hey chat! <ko>안녕 여러분!</ko> How are you today? <ko>오늘 어때?</ko>

Rules:
- Keep each English sentence short and conversational — it goes to a text-to-speech engine.
- Every English sentence must be followed by exactly one <ko>...</ko> with its Korean translation.
- Put ONLY the spoken English outside the tags and ONLY Korean inside <ko>. No markdown, no numbering, no narration, no notes about the format.
- Stay in character as neru at all times.`
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/stage-ui/src/constants/neru-persona.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add airi/packages/stage-ui/src/constants/neru-persona.ts airi/packages/stage-ui/src/constants/neru-persona.test.ts
git commit -m "feat(stage-ui): add neru bilingual system-prompt constant"
```

---

## Task 2: Preseed neru as the active character card

**Files:**
- Modify: `airi/apps/stage-tamagotchi/src/renderer/neruPreseed.ts`

**Interfaces:**
- Consumes: `NERU_SYSTEM_PROMPT` from Task 1 (`@proj-airi/stage-ui` — confirm the exact import path the app uses for stage-ui constants; other renderer imports from `@proj-airi/stage-ui` exist).
- Produces: on launch, localStorage `airi-card-active-id` = `"neru"` and `airi-cards` contains a `neru` card whose `systemPrompt` is `NERU_SYSTEM_PROMPT`.

**Required reading before coding:** open `airi/packages/stage-ui/src/stores/modules/airi-card.ts` and confirm (a) the minimal `AiriCard` shape consumed by `activeCard`/`systemPrompt` (interface at line 82; the `systemPrompt` computed at ~428 reads `card.systemPrompt`/`description`/`personality` with optional chaining on `extensions`), and (b) how `useLocalStorageManualReset<Map<...>>('airi-cards', new Map())` serialises — VueUse's Map serializer writes `JSON.stringify(Array.from(map.entries()))` and reads `new Map(JSON.parse(value))`. The preseed must write that entries-array shape, not a plain object.

- [ ] **Step 1: Add a Map-preseed helper + neru card to `preseedNeruProviders`**

Add near the existing `assertRaw`/`mergeObject` helpers:

```ts
// airi-cards는 VueUse Map 직렬화(엔트리 배열의 JSON)를 쓴다 — neru 카드를 그 형식으로
// 넣고 기존 카드는 보존한다. 활성 카드도 neru로 단언한다.
function assertNeruCard(systemPrompt: string): void {
  const key = 'airi-cards'
  let entries: [string, unknown][] = []
  const existing = localStorage.getItem(key)
  if (existing) {
    try {
      entries = JSON.parse(existing) as [string, unknown][]
      if (!Array.isArray(entries))
        entries = []
    }
    catch {
      entries = []
    }
  }
  const neruCard = {
    name: 'neru',
    version: '1.0.0',
    description: '',
    personality: '',
    systemPrompt,
    extensions: { airi: { modules: {} } },
  }
  const next = entries.filter(([id]) => id !== 'neru')
  next.push(['neru', neruCard])
  localStorage.setItem(key, JSON.stringify(next))
}
```

Then, at the end of `preseedNeruProviders()`:

```ts
  assertNeruCard(NERU_SYSTEM_PROMPT)
  assertRaw('airi-card-active-id', 'neru')
```

Add the import at the top of the file:

```ts
import { NERU_SYSTEM_PROMPT } from '@proj-airi/stage-ui/constants/neru-persona'
```

> If that exact subpath is not exported, import from wherever `@proj-airi/stage-ui` re-exports constants (grep the app's existing stage-ui imports); do not deep-import across a package boundary the package forbids.

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @proj-airi/stage-tamagotchi typecheck`
Expected: PASS (no type errors). If the minimal card object mismatches `AiriCard`, widen the object to satisfy the interface using the fields confirmed in the required-reading step — do not cast to `any`.

- [ ] **Step 3: Manual verification (documented, run in Task 7 E2E)**

The card is only observable at runtime; its correctness is verified in the Task 7 manual E2E (neru replies in English with Korean on screen). Note this in the commit body.

- [ ] **Step 4: Commit**

```bash
git add airi/apps/stage-tamagotchi/src/renderer/neruPreseed.ts
git commit -m "feat(stage-tamagotchi): preseed neru persona card active"
```

---

## Task 3: Categoriser recognises `<ko>` as a subtitle segment

**Files:**
- Modify: `airi/packages/core-agent/src/runtime/response-categoriser.ts:10,32-35`
- Test: `airi/packages/core-agent/src/runtime/response-categoriser.test.ts`

**Interfaces:**
- Produces: `ResponseCategory` gains `'subtitle'`; `categorizeResponse(text)` returns segments where a `<ko>` tag has `category: 'subtitle'`, `tagName: 'ko'`, `content: <korean>`; `speech` still excludes `<ko>` content.

- [ ] **Step 1: Write the failing test**

```ts
// 응답 카테고라이저의 <ko> 자막 분리 테스트
import { describe, expect, it } from 'vitest'
import { categorizeResponse } from './response-categoriser'

describe('categorizeResponse <ko> subtitle', () => {
  it('categorises <ko> as subtitle and keeps English as speech', () => {
    const r = categorizeResponse('Hello there. <ko>안녕하세요.</ko>')
    expect(r.speech).toBe('Hello there.')
    const ko = r.segments.find(s => s.tagName === 'ko')
    expect(ko?.category).toBe('subtitle')
    expect(ko?.content).toBe('안녕하세요.')
  })
  it('still treats <think> as reasoning', () => {
    const r = categorizeResponse('Hi. <think>plan</think>')
    expect(r.segments.find(s => s.tagName === 'think')?.category).toBe('reasoning')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core-agent/src/runtime/response-categoriser.test.ts`
Expected: FAIL (`ko` category is `reasoning`, not `subtitle`).

- [ ] **Step 3: Implement**

Change line 10:

```ts
export type ResponseCategory = 'speech' | 'reasoning' | 'subtitle' | 'unknown'
```

Change `mapTagNameToCategory` (lines 32-35):

```ts
function mapTagNameToCategory(tagName: string): ResponseCategory {
  // <ko>는 화면 자막(음성 제외), 그 외 태그는 기존대로 reasoning(음성·화면 모두 제외).
  if (tagName === 'ko')
    return 'subtitle'
  return 'reasoning'
}
```

> `speech` extraction already excludes ALL tag spans (lines 170-200), so `<ko>` stays out of the English speech automatically. `filterToSpeech` (streaming) likewise strips any tagged span, so English TTS is unaffected. No other change needed here.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core-agent/src/runtime/response-categoriser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add airi/packages/core-agent/src/runtime/response-categoriser.ts airi/packages/core-agent/src/runtime/response-categoriser.test.ts
git commit -m "feat(core-agent): categorise <ko> tags as subtitle"
```

---

## Task 4: Add an `onSubtitle` chat hook

**Files:**
- Modify: the chat-hooks module (locate by grepping `emitTokenLiteralHooks` and `onTokenLiteral` — they are defined together; likely under `airi/packages/core-agent/src/`).

**Interfaces:**
- Produces: `onSubtitle(cb: (koText: string, ctx) => void | Promise<void>)` registration and `emitSubtitleHooks(koText, ctx)` emitter, mirroring the existing `onTokenLiteral`/`emitTokenLiteralHooks` pair exactly (same context type, same async semantics, same cleanup registration).

**Required reading:** open the file that defines `emitTokenLiteralHooks`; copy the `onTokenLiteral`/`emitTokenLiteralHooks` pair's exact shape for the new pair.

- [ ] **Step 1: Add the hook pair**

Mirror the `onTokenLiteral`/`emitTokenLiteralHooks` definitions, renamed to `onSubtitle`/`emitSubtitleHooks`, carrying a `string` payload (the Korean sentence) plus the same context parameter the literal hook uses. Export `onSubtitle` from the same barrel/module the other `on*` hooks are exported from, and include `emitSubtitleHooks` in the hooks object passed into `createChatOrchestratorRuntime` (the `hooks` used at `chat-orchestrator-runtime.ts:520`).

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @proj-airi/stage-tamagotchi typecheck`
Expected: PASS. (No behaviour yet — the emitter is unused until Task 5.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(core-agent): add onSubtitle chat hook"
```

---

## Task 5: Route Korean to chat panel + subtitle hook; English to TTS only

**Files:**
- Modify: `airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts:504,507-534`

**Interfaces:**
- Consumes: `createStreamingCategorizer(providerId, onSegment)` (existing second param, `response-categoriser.ts:214-216`); the `subtitle` category from Task 3; `emitSubtitleHooks` from Task 4.
- Produces: English (outside tags) → `emitTokenLiteralHooks` only (→ TTS). `<ko>` content → `buildingMessage.content`/`slices` (chat panel) + `emitSubtitleHooks` (→ caption). No English in `buildingMessage.content`.

- [ ] **Step 1: Pass an `onSegment` handler to the categoriser (line 504)**

```ts
const categorizer = createStreamingCategorizer(deps.getActiveProvider(), (segment) => {
  if (segment.category !== 'subtitle')
    return
  const ko = segment.content.trim()
  if (!ko)
    return
  // 한국어는 화면(채팅 패널)으로 — 영어는 아래 onLiteral에서 TTS로만 간다.
  buildingMessage.content += (buildingMessage.content ? ' ' : '') + ko
  const lastSlice = buildingMessage.slices.at(-1)
  if (lastSlice?.type === 'text')
    lastSlice.text += ` ${ko}`
  else
    buildingMessage.slices.push({ type: 'text', text: ko })
  patchForegroundStream(sessionId, buildingMessage)
  void hooks.emitSubtitleHooks(ko, streamingMessageContext)
})
```

> `createStreamingCategorizer` fires `onSegment` when each tag completes (`response-categoriser.ts:332-340`), so each `<ko>` sentence is emitted once, in order.

- [ ] **Step 2: Stop putting English into the display in `onLiteral` (lines 517-533)**

Replace the body of `if (speechOnly.trim()) { ... }` so English goes ONLY to the TTS hook — remove the `buildingMessage.content += speechOnly`, the slices append, and the `patchForegroundStream` for English:

```ts
if (speechOnly.trim()) {
  // 영어(태그 밖)는 음성 채널로만 보낸다. 화면 텍스트는 위 onSegment에서 한국어로 채운다.
  await hooks.emitTokenLiteralHooks(speechOnly, streamingMessageContext)
}
```

- [ ] **Step 3: Add a runtime test for the split**

Add to (or create) `airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.test.ts` a test that drives the parser with `"Hello. <ko>안녕.</ko>"` and asserts: `emitTokenLiteralHooks` received `"Hello."`-derived English (no Korean), `emitSubtitleHooks` received `"안녕."`, and `buildingMessage.content` contains `"안녕."` and not `"Hello"`. Follow the existing test setup in that directory for constructing the runtime with mock hooks (read a sibling `*.test.ts` for the harness; mock `emitTokenLiteralHooks`/`emitSubtitleHooks` with `vi.fn()`).

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/core-agent/src/runtime/chat-orchestrator-runtime.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.test.ts
git commit -m "feat(core-agent): route <ko> to display+subtitle, English to TTS only"
```

---

## Task 6: Stage.vue — Korean caption overlay, drop English caption

**Files:**
- Modify: `airi/packages/stage-ui/src/components/scenes/Stage.vue:546-563,782-784` (region)

**Interfaces:**
- Consumes: `onSubtitle` from Task 4 (imported alongside the other `on*` chat hooks already imported in Stage.vue).

- [ ] **Step 1: Subscribe to `onSubtitle` and post Korean to the caption channel**

Add a hook registration next to the others (near line 782):

```ts
chatHookCleanups.push(onSubtitle(async (ko) => {
  // 한국어 자막을 오버레이 창으로 — 음성(영어)과 분리된 화면 텍스트.
  assistantCaption.value += ` ${ko}`
  try {
    postCaption({ type: 'caption-assistant', text: ko })
  }
  catch {
    // BroadcastChannel may be closed - don't break playback
  }
}))
```

- [ ] **Step 2: Remove the English caption post in `onStart` (lines 550-562)**

The audio segment `item.text` is English; it must not reach the screen. Delete the `assistantCaption.value += \` ${item.text}\``, the `postCaption({ type: 'caption-assistant', text: item.text })`, and the `postPresent({ type: 'assistant-append', text: item.text })` from the `onStart` callback (keep the callback itself and its try/catch scaffold only if still needed for other side effects — if the callback body becomes empty, keep `onStart` returning without posting). Lip-sync/speaking state is driven by `setSpeaking`, not `onStart`, so removing the posts does not affect the avatar mouth.

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @proj-airi/stage-tamagotchi typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add airi/packages/stage-ui/src/components/scenes/Stage.vue
git commit -m "feat(stage-ui): caption overlay shows Korean, not English speech text"
```

---

## Task 7: Manual end-to-end verification

**Files:** none (verification task).

- [ ] **Step 1: Launch and speak**

Ensure the local LLM proxy is on `:3456`. From `airi/`: `pnpm desktop`. Wait for `[neru-audio] 게이트웨이 준비됨`. Speak Korean into the mic (e.g. "안녕 뉴로, 자기소개 해줘").

- [ ] **Step 2: Verify the three properties**

Expected:
- **Voice:** neru speaks **intelligible English** (not garbled Korean-through-English).
- **Screen:** the caption overlay and chat panel show **Korean**, not English.
- **Gateway log:** `POST /v1/audio/transcriptions` 200 (STT), `POST /v1/audio/speech` 200 (TTS). Confirm the text sent to `/v1/audio/speech` is English (add a temporary log if unsure, then remove it).

If neru still replies in Korean voice: the card system prompt did not take effect — confirm `airi-card-active-id` = `neru` and the card's `systemPrompt` in the running renderer (DevTools `localStorage`), and that `initialize()` in `airi-card.ts` did not overwrite the active id.

- [ ] **Step 3: Note the deferred sync limitation**

v1 posts Korean captions at generation time; because TTS synthesis lags generation, the caption may lead the voice on long replies. Record this in `WORKSPACE.md` Known Issues as the follow-up for tight audio-synced captions (thread a `subtitle` field through the TTS segment → `PlaybackItem` → `onStart`). Commit the WORKSPACE note.

---

## Deferred (not in this plan)

- **Tight audio-synced captions:** carry the Korean per sentence onto the TTS `PlaybackItem` so the caption advances in lockstep with audio in `onStart`, replacing the generation-timed v1. Requires touching `packages/pipelines-audio/src/processors/tts-chunker.ts` (segment type) and the TTS session in `Stage.vue`.
- **English fallback for unpaired sentences:** the spec calls for showing the English on screen when the LLM omits a sentence's `<ko>`. This plan removes English from the display entirely, so an unpaired English sentence is spoken but not shown. The strict system prompt (Task 1) makes omissions rare; a proper fallback needs the same per-sentence pairing infrastructure as tight sync, so both land together in the sync follow-up. Until then, an omitted `<ko>` means that one sentence is unsubtitled — acceptable for v1, not silently dropped.
- Japanese/other target languages; streaming (`bidirectional-ws`) TTS path; neru witch Live2D model; rebrand.
