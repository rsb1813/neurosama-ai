# neru Proactive Speech (#3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the room goes quiet, neru speaks up on her own (in character, may reference her memory) via the normal chat/voice pipeline — seeded by a hidden system nudge, capped so she stops after a few un-answered turns.

**Architecture:** A renderer-side idle scheduler (`useProactiveSpeech` composable) tracks whether neru is busy (sending/speaking) and how long the room has been quiet. On idle it calls an injected `trigger()` that runs a normal chat turn (`chatStore.ingest`) seeded with a nudge whose role is **`system`** (invisible in the chat panel, not cloud-synced, still reaches the LLM) — so neru's reply streams, speaks, and lip-syncs exactly like a normal reply. A consecutive counter (reset on any real user send) stops her after N un-answered proactive turns. The idle trigger is **content-agnostic**: what neru does when idle is a swappable nudge policy, so future autonomous idle search / computer-agent (#7) use is a policy change, not an architecture change.

**Tech Stack:** TypeScript, Vue 3 composable (`onScopeDispose`), Pinia chat store, `@moeru/std` (`errorMessageFrom`), Vitest.

## Global Constraints

- **The proactive nudge must NOT render as a user utterance.** It is seeded as a `role: 'system'` message via a new `seedRole` send option; system messages are already not rendered by `history.vue` and already excluded from cloud sync — no UI change required.
- **Proactive speech reuses the normal turn pipeline** (`chatStore.ingest` → `performSend`). Do NOT build a parallel TTS/generate path (voice/lip-sync/barge-in only fire from inside `performSend`).
- **Never interrupt:** never trigger while a turn is sending, while neru is speaking (`nowSpeaking`), or while a proactive turn from this scheduler is itself in flight.
- **Consecutive cap:** after `maxConsecutive` (default **2**) proactive turns with no real user send in between, go quiet until the user sends (which resets the counter).
- **Config values (verbatim):** `idleDelayMs` default **45000**, `maxConsecutive` default **2**, `enabled` default true.
- **Content-agnostic trigger:** the nudge/policy is an isolated, replaceable constant. v1 policy = riff + memory, no autonomous search.
- New source files start with a one-line KOREAN comment header; comments Korean, identifiers/strings English. Use `errorMessageFrom` for error extraction. Composable logic must be unit-testable via an injected clock and injected callbacks (mirror `use-barge-in.ts`).
- Branch `feat/neru-proactive-speech` already exists (spec committed). Do not create the branch.

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts` | Modify (`ChatOrchestratorSendOptions` ~58-71; `performSend` seed ~490-515) | Add `seedRole?: 'user' \| 'system'`; seed message uses it; gate user-turn side effects on `seedRole === 'user'` |
| `airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.test.ts` | Modify (extend existing harness tests) | Assert a `system`-seed turn does not fire user-turn hooks and seeds a `system` message |
| `airi/packages/stage-ui/src/composables/use-proactive-speech.ts` | Create | Pure idle/guard/cap state machine + `useProactiveSpeech` composable + the nudge policy constant |
| `airi/packages/stage-ui/src/composables/use-proactive-speech.test.ts` | Create | Unit tests for the state machine (fake clock + mock trigger) and the nudge policy |
| `airi/packages/stage-ui/src/components/scenes/Stage.vue` | Modify (near the existing chat-hook wiring ~109 / speaking refs ~93) | Instantiate `useProactiveSpeech`; feed `isBusy`, build the `ingest` options, `trigger` with `seedRole:'system'`, reset on user send |

---

## Task 1: `seedRole` send option (hidden system-seeded turns)

**Files:**
- Modify: `airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts` (interface ~58-71; `performSend` ~490-515)
- Test: `airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.test.ts` (extend)

**Interfaces:**
- Produces: `ChatOrchestratorSendOptions` gains `seedRole?: 'user' | 'system'` (default `'user'`). When `seedRole === 'system'`, the seed message is appended with `role: 'system'` and the user-turn side effects (`onUserMessageAppended`, `onUserTurnReady`, user-turn analytics) are skipped; the turn otherwise runs identically (LLM stream, hooks, TTS).

- [ ] **Step 1: Read the existing runtime test harness**

Open `airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.test.ts` and find the existing harness helper it uses to build a runtime with mock deps (e.g. a `createHarness()`/`makeRuntime()` that stubs `session`, `onUserMessageAppended`, `stream`, etc., and lets a test call `runtime.ingest(...)` then drain). You will extend it; reuse its exact setup.

- [ ] **Step 2: Write the failing test**

Add to `chat-orchestrator-runtime.test.ts` (adapt the harness variable names to the file's existing helper — this asserts the behavior, using the same mock-deps pattern already in the file):

```ts
it('seedRole:"system" seeds a system message and skips user-turn side effects', async () => {
  // 능동 발화: system 씨앗 턴은 사용자 메시지가 아니므로 user-turn 훅/분석을 타면 안 되고,
  // 세션에 append되는 씨앗 메시지의 role은 'system'이어야 한다(렌더/동기화에서 자동 제외됨).
  const harness = createHarness() // ← the file's existing harness factory
  await harness.runtime.ingest('(proactive nudge)', { ...harness.baseSendOptions, seedRole: 'system' })
  await harness.drain() // ← the file's existing "await the queued send" helper

  const appended = harness.appendedMessages() // ← messages passed to deps.session.appendSessionMessage
  const seed = appended.find(m => m.content === '(proactive nudge)')
  expect(seed?.role).toBe('system')
  expect(harness.onUserMessageAppended).not.toHaveBeenCalled()
  expect(harness.onUserTurnReady).not.toHaveBeenCalled()
})

it('default seedRole keeps user-turn behavior', async () => {
  const harness = createHarness()
  await harness.runtime.ingest('hello', { ...harness.baseSendOptions })
  await harness.drain()
  const seed = harness.appendedMessages().find(m => m.content === 'hello')
  expect(seed?.role).toBe('user')
  expect(harness.onUserMessageAppended).toHaveBeenCalled()
})
```

If the existing harness does not expose `appendedMessages()` / `onUserMessageAppended` spies, add minimal spies to the harness's mock `deps` (the file already stubs `deps.session.appendSessionMessage` and `deps.onUserMessageAppended` — assert against those existing stubs instead of adding new surface).

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd airi && pnpm exec vitest run packages/core-agent/src/runtime/chat-orchestrator-runtime.test.ts -t seedRole`
Expected: FAIL — the system case gets `role: 'user'` and the user-turn hooks fire (seedRole not honored yet).

- [ ] **Step 4: Add `seedRole` to the options interface**

In `chat-orchestrator-runtime.ts`, inside `ChatOrchestratorSendOptions` (~58-71), add the field:

```ts
export interface ChatOrchestratorSendOptions {
  model: string
  chatProvider: ChatProvider
  providerConfig?: Record<string, unknown>
  attachments?: { type: 'image', data: string, mimeType: string }[]
  tools?: StreamOptions['tools']
  input?: ChatStreamEventContext['input']
  // 씨앗 메시지 역할. 'system'이면 사용자 발화가 아니라 '조용히 말 걸어' 넛지로 취급한다
  // (렌더/클라우드 동기화에서 자동 제외되고, user-turn 훅/분석을 건너뛴다). 기본 'user'.
  seedRole?: 'user' | 'system'
}
```

- [ ] **Step 5: Use `seedRole` for the seed message and gate user-turn side effects**

In `performSend`, at the seed-message block (~490-497), replace the hardcoded role and gate the user-turn effects. Change:

```ts
      const userMessageId = createId()
      const userMessage = {
        role: 'user' as const,
        content: finalContent,
        createdAt: sendingCreatedAt,
        id: userMessageId,
      }
      deps.session.appendSessionMessage(sessionId, userMessage)
      const userTurnIndex = deps.session.getSessionMessages(sessionId).filter(message => message.role === 'user').length

      deps.onUserMessageAppended?.({ sessionId, message: userMessage, messageText: sendingMessage, source: sendSource, model: options.model, provider: activeProvider, turnIndex: userTurnIndex })

      const sessionMessagesForSend = deps.session.getSessionMessages(sessionId)
      deps.onUserTurnReady?.({ messageText: sendingMessage, sessionMessages: sessionMessagesForSend, ... })
```

to (keep the exact payloads/`...` that already exist — only the role and the two guards change):

```ts
      const seedRole = options.seedRole ?? 'user'
      const userMessageId = createId()
      const userMessage = {
        role: seedRole,
        content: finalContent,
        createdAt: sendingCreatedAt,
        id: userMessageId,
      }
      deps.session.appendSessionMessage(sessionId, userMessage)

      // system 씨앗(능동 발화 넛지)은 사용자 턴이 아니므로 user-turn 분석/훅을 타지 않는다.
      if (seedRole === 'user') {
        const userTurnIndex = deps.session.getSessionMessages(sessionId).filter(message => message.role === 'user').length
        deps.onUserMessageAppended?.({ sessionId, message: userMessage, messageText: sendingMessage, source: sendSource, model: options.model, provider: activeProvider, turnIndex: userTurnIndex })
        const sessionMessagesForSend = deps.session.getSessionMessages(sessionId)
        deps.onUserTurnReady?.({ messageText: sendingMessage, sessionMessages: sessionMessagesForSend, ... })
      }
```

Note: `userMessage.role` is now `'user' | 'system'`; if TypeScript complains that `appendSessionMessage`/the local type expects a narrower literal, type the object as `ChatMessage` / annotate `role: seedRole satisfies 'user' | 'system'` — do NOT cast to `any`. `ChatHistoryItem` already permits `role: 'system'` (`packages/core-agent/src/types/chat.ts`), so the append is type-valid. Keep every existing field in the two payloads exactly as-is; only wrap them in the `if` and swap the role.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd airi && pnpm exec vitest run packages/core-agent/src/runtime/chat-orchestrator-runtime.test.ts`
Expected: PASS (the two new tests + all pre-existing runtime tests still green).

- [ ] **Step 7: Typecheck**

Run: `cd airi && pnpm -F @proj-airi/core-agent build` (this package ships built types; build = typecheck + emit)
Expected: exit 0. Then `cd airi && pnpm exec eslint packages/core-agent/src/runtime/chat-orchestrator-runtime.ts` → exit 0.

- [ ] **Step 8: Commit**

```bash
git add airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.test.ts
git commit -m "feat(core-agent): seedRole send option for hidden system-seeded (proactive) turns"
```

---

## Task 2: `useProactiveSpeech` composable + nudge policy

**Files:**
- Create: `airi/packages/stage-ui/src/composables/use-proactive-speech.ts`
- Test: `airi/packages/stage-ui/src/composables/use-proactive-speech.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 directly (Task 3 wires them together).
- Produces:
  - `const PROACTIVE_NUDGE: string` — the swappable content policy seed.
  - `interface ProactiveSpeechOptions { idleDelayMs?: number, maxConsecutive?: number, enabled?: boolean, isBusy: () => boolean, trigger: () => Promise<void>, now?: () => number, setTimer?: (cb: () => void, ms: number) => unknown, clearTimer?: (h: unknown) => void }`
  - `interface ProactiveSpeechController { recordUserActivity: () => void, noteTurnComplete: () => void, dispose: () => void }`
  - `function createProactiveScheduler(options: ProactiveSpeechOptions): ProactiveSpeechController` — the pure-ish state machine (injectable timer/clock).
  - `function useProactiveSpeech(options: ProactiveSpeechOptions): ProactiveSpeechController` — the composable wrapper that calls `createProactiveScheduler` and registers `onScopeDispose(controller.dispose)`.

- [ ] **Step 1: Write the failing tests**

Create `airi/packages/stage-ui/src/composables/use-proactive-speech.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { createProactiveScheduler, PROACTIVE_NUDGE } from './use-proactive-speech'

// 주입식 가짜 타이머: setTimer가 준 콜백을 수동으로 실행해 시간 경과를 흉내낸다.
function fakeTimers() {
  const cbs = new Map<number, () => void>()
  let id = 0
  return {
    setTimer: (cb: () => void, _ms: number) => { const h = ++id; cbs.set(h, cb); return h },
    clearTimer: (h: unknown) => { cbs.delete(h as number) },
    fireLatest: () => { const last = [...cbs.keys()].at(-1); if (last != null) { const cb = cbs.get(last)!; cbs.delete(last); cb() } },
    pending: () => cbs.size,
  }
}

function makeOpts(over: Partial<Parameters<typeof createProactiveScheduler>[0]> = {}) {
  const t = fakeTimers()
  const trigger = vi.fn(async () => {})
  return { t, trigger, opts: { idleDelayMs: 1000, maxConsecutive: 2, enabled: true, isBusy: () => false, trigger, setTimer: t.setTimer, clearTimer: t.clearTimer, ...over } }
}

describe('createProactiveScheduler', () => {
  it('fires the trigger after the idle delay', async () => {
    const { t, trigger, opts } = makeOpts()
    createProactiveScheduler(opts)
    t.fireLatest() // idle window elapses
    await Promise.resolve()
    expect(trigger).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire while neru is busy (sending/speaking)', async () => {
    const { t, trigger, opts } = makeOpts({ isBusy: () => true })
    createProactiveScheduler(opts)
    t.fireLatest()
    await Promise.resolve()
    expect(trigger).not.toHaveBeenCalled()
  })

  it('stops after maxConsecutive un-answered fires', async () => {
    const { t, trigger, opts } = makeOpts({ maxConsecutive: 2 })
    createProactiveScheduler(opts)
    t.fireLatest(); await Promise.resolve() // 1
    t.fireLatest(); await Promise.resolve() // 2
    t.fireLatest(); await Promise.resolve() // capped — no 3rd
    expect(trigger).toHaveBeenCalledTimes(2)
  })

  it('recordUserActivity resets the counter and re-enables firing', async () => {
    const { t, trigger, opts } = makeOpts({ maxConsecutive: 1 })
    const c = createProactiveScheduler(opts)
    t.fireLatest(); await Promise.resolve() // 1 (now capped)
    t.fireLatest(); await Promise.resolve() // capped
    expect(trigger).toHaveBeenCalledTimes(1)
    c.recordUserActivity() // user spoke → reset
    t.fireLatest(); await Promise.resolve()
    expect(trigger).toHaveBeenCalledTimes(2)
  })

  it('does nothing when disabled', async () => {
    const { t, trigger, opts } = makeOpts({ enabled: false })
    createProactiveScheduler(opts)
    expect(t.pending()).toBe(0)
    t.fireLatest()
    await Promise.resolve()
    expect(trigger).not.toHaveBeenCalled()
  })

  it('dispose clears pending timers', () => {
    const { t, opts } = makeOpts()
    const c = createProactiveScheduler(opts)
    expect(t.pending()).toBe(1)
    c.dispose()
    expect(t.pending()).toBe(0)
  })
})

describe('PROACTIVE_NUDGE', () => {
  it('instructs unprompted, brief, in-character speech and no searching', () => {
    expect(PROACTIVE_NUDGE).toMatch(/on your own|unprompted/i)
    expect(PROACTIVE_NUDGE).toMatch(/short|brief/i)
    expect(PROACTIVE_NUDGE).toMatch(/do not search|don't search/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd airi && pnpm exec vitest run packages/stage-ui/src/composables/use-proactive-speech.test.ts`
Expected: FAIL — cannot find module `./use-proactive-speech`.

- [ ] **Step 3: Implement the composable**

Create `airi/packages/stage-ui/src/composables/use-proactive-speech.ts`:

```ts
// neru가 유휴 시 스스로 말을 걸게 하는 능동 발화 스케줄러 + 컴포저블.
import { onScopeDispose } from 'vue'

// 능동 발화의 "내용 정책"(교체 가능한 넛지). 트리거는 content-agnostic이라, 나중에 자율 검색/컴퓨터
// 사용(#7)을 열려면 아키텍처가 아니라 이 문자열/정책만 바꾸면 된다. v1: 리핑+기억, 검색 안 함.
export const PROACTIVE_NUDGE = 'The room has gone quiet. Say something on your own, unprompted — riff, react, or bring up something you remember about the user. Keep it short and in character. Do not search the web for this.'

export interface ProactiveSpeechOptions {
  /** 유휴 판정까지의 시간(ms). @default 45000 */
  idleDelayMs?: number
  /** 무응답 연속 능동 발화 상한. @default 2 */
  maxConsecutive?: number
  /** 기능 on/off. @default true */
  enabled?: boolean
  /** neru가 지금 바쁜지(전송/발화 중) — true면 발동을 건너뛴다. */
  isBusy: () => boolean
  /** 능동 턴 실행(넛지를 system 씨앗으로 ingest). 절대 throw하지 않아야 한다(내부에서 처리). */
  trigger: () => Promise<void>
  /** 테스트 주입용 타이머(기본 setTimeout/clearTimeout). */
  setTimer?: (cb: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
}

export interface ProactiveSpeechController {
  /** 사용자 활동(실제 전송 등) — 연속 카운터와 유휴 타이머를 리셋한다. */
  recordUserActivity: () => void
  /** 어떤 턴이 끝났을 때 — 유휴 타이머를 다시 무장한다. */
  noteTurnComplete: () => void
  /** 타이머 정리. */
  dispose: () => void
}

export function createProactiveScheduler(options: ProactiveSpeechOptions): ProactiveSpeechController {
  const idleDelayMs = options.idleDelayMs ?? 45000
  const maxConsecutive = options.maxConsecutive ?? 2
  const enabled = options.enabled ?? true
  const setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms))
  const clearTimer = options.clearTimer ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>))

  let consecutive = 0
  let handle: unknown = null
  let firing = false

  function clear() {
    if (handle != null) {
      clearTimer(handle)
      handle = null
    }
  }

  function arm() {
    clear()
    if (!enabled || consecutive >= maxConsecutive)
      return
    handle = setTimer(onIdle, idleDelayMs)
  }

  function onIdle() {
    handle = null
    // 가드: 바쁘거나 상한 도달이거나 이미 발동 중이면 건너뛰고 재무장한다.
    if (firing || options.isBusy() || consecutive >= maxConsecutive) {
      arm()
      return
    }
    firing = true
    consecutive += 1
    // trigger는 throw하지 않기로 계약돼 있지만, 방어적으로 감싸 스케줄러가 죽지 않게 한다.
    Promise.resolve()
      .then(() => options.trigger())
      .catch(() => {})
      .finally(() => {
        firing = false
        arm() // 다음 유휴 창을 무장(상한 도달 시 arm이 알아서 멈춤).
      })
  }

  arm()

  return {
    recordUserActivity() {
      consecutive = 0
      arm()
    },
    noteTurnComplete() {
      arm()
    },
    dispose() {
      clear()
    },
  }
}

export function useProactiveSpeech(options: ProactiveSpeechOptions): ProactiveSpeechController {
  const controller = createProactiveScheduler(options)
  onScopeDispose(() => controller.dispose())
  return controller
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd airi && pnpm exec vitest run packages/stage-ui/src/composables/use-proactive-speech.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck + lint**

Run: `cd airi && pnpm -F @proj-airi/stage-ui typecheck` → exit 0.
Run: `cd airi && pnpm exec eslint packages/stage-ui/src/composables/use-proactive-speech.ts packages/stage-ui/src/composables/use-proactive-speech.test.ts` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add airi/packages/stage-ui/src/composables/use-proactive-speech.ts airi/packages/stage-ui/src/composables/use-proactive-speech.test.ts
git commit -m "feat(stage-ui): useProactiveSpeech idle scheduler + nudge policy"
```

---

## Task 3: Wire proactive speech into Stage.vue

**Files:**
- Modify: `airi/packages/stage-ui/src/components/scenes/Stage.vue`

**Interfaces:**
- Consumes: `useProactiveSpeech`, `PROACTIVE_NUDGE` (Task 2); the `seedRole: 'system'` send option (Task 1); the chat store `ingest` + `sending`, the speaking store `nowSpeaking`, the providers store (to build the ingest options exactly like `ChatArea.vue` does), and the chat hooks `onBeforeSend` / `onChatTurnComplete`.

- [ ] **Step 1: Confirm the signals available in Stage.vue**

In `Stage.vue`, confirm these are already in scope (from the existing setup): `nowSpeaking` (from `useSpeakingStore()`, ~line 93) and the chat orchestrator store (the one exposing `ingest`, `sending`, `onBeforeSend`, `onChatTurnComplete`). Find how `ChatArea.vue` builds `ingest` options (it uses `providersStore.getProviderInstance(activeProvider.value)`, `activeModel.value`, `providersStore.getProviderConfig(activeProvider.value)`) — you will mirror that. Import `useProvidersStore` and the active provider/model refs the same way `ChatArea.vue` / the consciousness settings do if not already present.

- [ ] **Step 2: Add the proactive wiring**

In `Stage.vue`'s `<script setup>`, after the existing chat-hook wiring, add (adjust the exact store accessors to the names already imported in this file — the chat store is already used here for `onTokenLiteral`/`onSubtitle`; reuse that same store instance):

```ts
import { PROACTIVE_NUDGE, useProactiveSpeech } from '../../composables/use-proactive-speech'
// (providers store + active provider/model — import the same ones ChatArea.vue uses if not already in scope)

// 능동 발화: 유휴 시 neru가 스스로 말을 건다. 넛지는 system 씨앗으로 넣어 채팅창에 안 보이게 하고,
// 그 외엔 평소 턴과 동일하게 스트리밍·발화된다(음성/립싱크/barge-in 재사용).
const proactive = useProactiveSpeech({
  isBusy: () => sending.value || nowSpeaking.value,
  trigger: async () => {
    const providerConfig = providersStore.getProviderConfig(activeProvider.value)
    await chatOrchestrator.ingest(PROACTIVE_NUDGE, {
      chatProvider: await providersStore.getProviderInstance(activeProvider.value) as ChatProvider,
      model: activeModel.value,
      providerConfig,
      seedRole: 'system',
    })
  },
})

// 사용자가 실제로 전송하면 연속 카운터를 리셋한다(무응답 상한 해제).
chatHookCleanups.push(onBeforeSend(async () => { proactive.recordUserActivity() }))
// 어떤 턴이 끝나든(사용자든 능동이든) 유휴 타이머를 다시 무장한다.
chatHookCleanups.push(onChatTurnComplete(async () => { proactive.noteTurnComplete() }))
```

Notes:
- `sending` here is the chat store's `sending` ref (already reactive). `nowSpeaking` is the existing speaking ref.
- Use the file's existing `chatHookCleanups` array (Stage.vue already collects hook cleanups) so the hooks unsubscribe on unmount; the composable's own `onScopeDispose` clears the idle timer.
- If `onChatTurnComplete` is not among the hooks already destructured in this file, add it to the existing destructure from the chat orchestrator store (it is exported by the store — `packages/stage-ui/src/stores/chat.ts:403`).
- The `trigger` swallows nothing important: `ingest` failures surface as an `error` message via the store's own path; do NOT add retry. The composable already guards against a thrown `trigger`.

- [ ] **Step 3: Typecheck + lint**

Run: `cd airi && pnpm -F @proj-airi/stage-ui typecheck` → exit 0.
Run: `cd airi && pnpm exec eslint packages/stage-ui/src/components/scenes/Stage.vue` → exit 0.
(There is no unit test for `Stage.vue` wiring — it is glue; the logic is covered by Task 2's tests and the manual check below.)

- [ ] **Step 4: Commit**

```bash
git add airi/packages/stage-ui/src/components/scenes/Stage.vue
git commit -m "feat(stage-ui): wire proactive speech into the stage"
```

---

## Manual verification (end-to-end, after all tasks)

1. Launch neru (`cd airi && pnpm -F @proj-airi/stage-tamagotchi dev`).
2. Send a message, get a reply, then **leave it idle ~45s** → neru speaks on her own (English voice + `<ko>` subtitle), and the chat panel shows only her line (no fake "user" line).
3. Keep ignoring her → she speaks at most `maxConsecutive` (2) times, then goes quiet.
4. Send a message → the counter resets; after the next idle window she can speak again.
5. Confirm she never talks over herself or interrupts while a turn is streaming or she is already speaking.

## Notes for the final reviewer

- **`seedRole: 'system'` relies on two existing behaviors** (proven in the codebase): `history.vue` has no render branch for `role: 'system'` (the opening system prompt already uses this), and `isCloudSyncableMessage` already excludes `system`. If either changes, the nudge could leak into the UI — worth a glance that the seed truly doesn't render/sync.
- **"User activity" in v1 = user *send* + turn completion**, not keystroke-level typing. Firing during active typing is unlikely given the 45s window and harmless (in-progress input is preserved by the input widget). Keystroke-level suppression can later feed `proactive.recordUserActivity()` from the input widget — deliberately out of scope for v1 (flagged in the spec's open questions).
- **Content-agnostic trigger:** enabling autonomous idle search / #7 computer-agent use later is a change to `PROACTIVE_NUDGE` (+ tool guidance), not to the scheduler or the wiring.
- The three knobs are hardcoded defaults (45000 / 2 / true) for v1; a settings UI is out of scope.
