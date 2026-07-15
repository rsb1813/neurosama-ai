# neru Barge-in (M-G) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user starts speaking while neru is talking or generating, neru stops immediately — TTS halts, the in-flight LLM stream is cancelled, and the already-spoken partial reply is kept in history.

**Architecture:** Reuse the existing TTS stop path (`requestStopSpeaking`). Build an in-flight LLM `AbortController` in the chat orchestrator runtime (the `abortSignal` is already plumbed to `streamText`). Add a dedicated `useBargeIn` composable that owns a Silero VAD instance on the live mic stream and, on speech-start, fires both stops when neru is busy. Wire it in `Stage.vue`.

**Tech Stack:** Vue 3 + Pinia + VueUse, TypeScript, Vitest. Silero VAD (client-side web worker, already in the repo). Design spec: `docs/superpowers/specs/2026-07-15-neru-barge-in-design.md`.

## Global Constraints

- Branch: `feat/neru-barge-in` (already checked out). Do NOT push/PR/merge — the human merges.
- Never kill the LLM proxy on port 3456 (PID may vary; it is not our process).
- Audio assumption: **headphones** — no acoustic echo cancellation or TTS-time VAD gating in scope.
- Reuse the existing stop path; do NOT reimplement TTS stopping. Only add a new `SpeechOutputStopReason` value `'barge-in'`.
- Keep the partial spoken reply in history on barge-in abort (spec D3). An abort is NOT a failure — do not fire the failure/error path for it.
- Trigger = Silero VAD speech-start with the library defaults (threshold 0.52, minSpeechDurationMs 300). No sensitivity UI (YAGNI). No unified turn-state machine (gate on existing `nowSpeaking`/`sending`).
- New source files start with a one-line Korean header comment (project rule §17). Comments in Korean; identifiers/strings in English.
- Test commands run from `airi/`:
  - core-agent: `pnpm -F @proj-airi/core-agent exec vitest run <relative path>`
  - stage-ui: `pnpm -F @proj-airi/stage-ui exec vitest run <relative path>`
  - typecheck: `pnpm -F @proj-airi/core-agent typecheck` / `pnpm -F @proj-airi/stage-ui typecheck`
  - lint a file: `node node_modules/eslint/bin/eslint.js <file>` (run `pnpm exec eslint` crashes on this repo/host — use the direct binary)

## File Structure

- `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts` — MODIFY: add `activeAbortController` + `abortActiveStream`; pass `abortSignal`; handle abort gracefully in the `catch`.
- `packages/stage-ui/src/stores/chat.ts` — MODIFY: re-expose `abortActiveStream` on the store.
- `packages/stage-ui/src/composables/audio/use-barge-in.ts` — CREATE: `shouldBargeIn` + `useBargeIn`.
- `packages/stage-ui/src/composables/audio/use-barge-in.test.ts` — CREATE: unit tests.
- `packages/stage-ui/src/stores/speech-output-control.ts` — MODIFY: add `'barge-in'` to `SpeechOutputStopReason`.
- `packages/stage-ui/src/components/scenes/Stage.vue` — MODIFY: instantiate `useBargeIn` with real dependencies.
- `packages/core-agent/src/runtime/chat-orchestrator-runtime.test.ts` — MODIFY: add abort tests (reuse the existing harness in this file).

---

### Task 1: LLM in-flight abort in the chat orchestrator runtime

Adds a per-send `AbortController`, passes its signal to the LLM stream, exposes `abortActiveStream()` on the runtime and the chat store. (Graceful abort handling — persisting the partial — is Task 2.)

**Files:**
- Modify: `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts`
- Modify: `packages/stage-ui/src/stores/chat.ts`
- Test: `packages/core-agent/src/runtime/chat-orchestrator-runtime.test.ts`

**Interfaces:**
- Produces: `runtime.abortActiveStream(): void` and `useChatOrchestratorStore().abortActiveStream(): void` — aborts the in-flight LLM stream if one is running; no-op otherwise.

- [ ] **Step 1: Write the failing test**

Add to `packages/core-agent/src/runtime/chat-orchestrator-runtime.test.ts`. **Reuse the existing harness in this file** — it already builds `const runtime = createChatOrchestratorRuntime({ ... })` (around line 59) and a `stream` mock (`const stream = vi.fn(async (_model, _chatProvider, _messages, options?) => { ... })` around line 47). Extend the mock's typed options with `abortSignal?: AbortSignal`, and trigger a send the same way the existing tests do (via `runtime.ingest(message, options)` with the harness's send options). Add these two tests:

```ts
it('passes an AbortSignal to the LLM stream', async () => {
  let capturedSignal: AbortSignal | undefined
  // Reuse the harness's makeRuntime()/stream mock; override the stream impl to capture the signal.
  stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options?: { abortSignal?: AbortSignal, onStreamEvent?: (e: StreamEvent) => Promise<void> | void }) => {
    capturedSignal = options?.abortSignal
    await options?.onStreamEvent?.({ type: 'text-delta', text: 'hi' })
    await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
  })
  await runtime.ingest('hello', sendOptions) // sendOptions = the harness's standard send options
  expect(capturedSignal).toBeInstanceOf(AbortSignal)
})

it('abortActiveStream() aborts the in-flight stream', async () => {
  let capturedSignal: AbortSignal | undefined
  let releaseStream: () => void = () => {}
  const streamGate = new Promise<void>((resolve) => { releaseStream = resolve })
  stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options?: { abortSignal?: AbortSignal, onStreamEvent?: (e: StreamEvent) => Promise<void> | void }) => {
    capturedSignal = options?.abortSignal
    await options?.onStreamEvent?.({ type: 'text-delta', text: 'partial' })
    await streamGate // hang mid-stream until the test releases it
  })
  const sendPromise = runtime.ingest('hello', sendOptions)
  await vi.waitFor(() => expect(capturedSignal).toBeInstanceOf(AbortSignal))
  runtime.abortActiveStream()
  expect(capturedSignal!.aborted).toBe(true)
  releaseStream()
  await sendPromise.catch(() => {}) // may reject with AbortError; Task 2 makes it graceful
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @proj-airi/core-agent exec vitest run src/runtime/chat-orchestrator-runtime.test.ts`
Expected: FAIL — `runtime.abortActiveStream is not a function`, and `capturedSignal` is `undefined` (no `abortSignal` passed yet).

- [ ] **Step 3: Add the AbortController and abortActiveStream in the runtime**

In `chat-orchestrator-runtime.ts`, near the other mutable runtime state (where `let sending` / `let pendingQueuedSends` are declared), add:

```ts
  let activeAbortController: AbortController | undefined
```

In `performSend`, right after `setSending(true)` (line 419), create the controller:

```ts
    setSending(true)
    activeAbortController = new AbortController()
```

Pass the signal into the stream options object at line 682 (add as the first property):

```ts
      await deps.llm.stream(options.model, options.chatProvider, newMessages as Message[], {
        abortSignal: activeAbortController.signal,
        headers,
        tools: options.tools,
        waitForTools: true,
        captureToolErrors: true,
        onStreamEvent: async (event: StreamEvent) => {
```

Clear the controller in the existing `finally` block (lines 806-809):

```ts
    finally {
      activeAbortController = undefined
      setSending(false)
      deps.onSendSettled?.({ sessionId })
    }
```

Add the abort function above the runtime `return` (near `cancelPendingSends`, ~line 865):

```ts
  function abortActiveStream() {
    activeAbortController?.abort()
  }
```

Add it to the runtime return object (lines 891-899):

```ts
  return {
    ingest,
    cancelPendingSends,
    abortActiveStream,
    getPendingQueuedSendSnapshot,
    getPendingQueuedSendCount: () => pendingQueuedSends.length,
    getSending: () => sending,
    setSending,
    hooks,
  }
```

- [ ] **Step 4: Re-expose abortActiveStream on the chat store**

In `packages/stage-ui/src/stores/chat.ts`, add a wrapper next to `cancelPendingSends` (lines 356-358):

```ts
  function abortActiveStream() {
    runtime.abortActiveStream()
  }
```

Add it to the store return object (near `cancelPendingSends`, ~line 370):

```ts
    cancelPendingSends,
    abortActiveStream,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -F @proj-airi/core-agent exec vitest run src/runtime/chat-orchestrator-runtime.test.ts`
Expected: PASS (both new tests green; existing tests still green).

- [ ] **Step 6: Typecheck**

Run: `pnpm -F @proj-airi/core-agent typecheck` then `pnpm -F @proj-airi/stage-ui typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.test.ts airi/packages/stage-ui/src/stores/chat.ts
git commit -m "feat(core-agent): add in-flight LLM stream abort (abortActiveStream)"
```

---

### Task 2: Persist the partial reply on barge-in abort (no failure event)

On abort, `deps.llm.stream(...)` rejects with an `AbortError`, which currently hits `performSend`'s `catch` (line 795) — it logs an error, fires `onChatActivationFailed`, and rethrows. That drops the partial reply and surfaces a false failure. This task makes an intentional abort persist the partial (mirroring the normal finalize at lines 755-763) and skip the failure path.

**Files:**
- Modify: `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts`
- Test: `packages/core-agent/src/runtime/chat-orchestrator-runtime.test.ts`

**Interfaces:**
- Consumes: `activeAbortController` (Task 1). Uses the in-scope `buildingMessage`, `sessionId`, `isStaleGeneration`, `deps` inside `performSend`.

- [ ] **Step 1: Write the failing test**

Add to `chat-orchestrator-runtime.test.ts`, reusing the harness. The harness's `deps.session` mock records appended messages (find its `appendSessionMessage` spy / the session store the harness builds; assert against it). If the harness exposes appended messages differently, assert through that same channel.

```ts
it('keeps the partial reply and does not fail when barge-in aborts the stream', async () => {
  const onChatActivationFailed = vi.fn()
  // Rebuild the runtime with an onChatActivationFailed spy (follow the harness's deps-override pattern),
  // or assert the harness's existing failure hook was not called.
  let releaseStream: () => void = () => {}
  const streamGate = new Promise<void>((resolve) => { releaseStream = resolve })
  stream.mockImplementationOnce(async (_m, _p, _msgs, options?: { abortSignal?: AbortSignal, onStreamEvent?: (e: StreamEvent) => Promise<void> | void }) => {
    await options?.onStreamEvent?.({ type: 'text-delta', text: 'half a sentence' })
    await streamGate
    // After release, throw as @xsai does on abort:
    const err = new Error('aborted'); err.name = 'AbortError'; throw err
  })
  const sendPromise = runtime.ingest('hello', sendOptions)
  await vi.waitFor(() => expect(runtime.getSending()).toBe(true)) // send is in-flight (the delta streamed before the gate await)
  runtime.abortActiveStream()
  releaseStream()
  await sendPromise
  // The partial assistant message is persisted:
  expect(getAppendedAssistantMessages().some(m => (m.content ?? '').includes('half a sentence'))).toBe(true)
  // And no failure was reported:
  expect(onChatActivationFailed).not.toHaveBeenCalled()
})
```

> Note for the implementer: replace `getAppendedAssistantMessages()`/`onChatActivationFailed` with the harness's actual mechanisms (the `deps.session` append spy and the `onChatActivationFailed` dep). The assertion intent is fixed: partial content is appended to the session, and `onChatActivationFailed` is not called.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @proj-airi/core-agent exec vitest run src/runtime/chat-orchestrator-runtime.test.ts`
Expected: FAIL — the partial is not appended (append is gated behind the try block that the abort skipped) and/or `onChatActivationFailed` was called.

- [ ] **Step 3: Handle abort gracefully in the catch**

In `performSend`'s `catch` (line 795), branch on the abort before the failure handling. Detect the intentional abort via the controller's signal (still set in `catch`; `finally` clears it afterward). Mirror the normal-finalize append (lines 755-763):

```ts
    catch (error) {
      // 사용자가 끼어들어(barge-in) 스트림을 취소한 경우: 실패가 아니라 정상 중단이다.
      // 이미 스트리밍된 반쪽 답변을 히스토리에 남기고 실패 이벤트는 내지 않는다(spec D3).
      if (activeAbortController?.signal.aborted) {
        if (!isStaleGeneration() && buildingMessage.slices.length > 0) {
          deps.session.appendSessionMessage(sessionId, buildingMessage)
          deps.onAssistantMessageAppended?.({
            sessionId,
            message: buildingMessage,
            messageText: buildingMessage.content,
          })
        }
        return
      }
      console.error('Error sending message:', error)
      deps.onChatActivationFailed?.({
        source: sendSource,
        model: options.model,
        provider: activeProvider,
        failureStage: 'llm_response',
        errorCode: 'llm_response_failed',
      })
      throw error
    }
```

> If `buildingMessage.content` is not the accumulated text in this scope, use the same value the normal path passes as `messageText` at line 761 (`fullText`); if `fullText` is declared inside the `try` and not visible in `catch`, hoist its declaration to the top of `performSend` (before the `try`). Confirm by reading the `fullText` declaration.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @proj-airi/core-agent exec vitest run src/runtime/chat-orchestrator-runtime.test.ts`
Expected: PASS (partial appended, no failure event). Existing tests still green.

- [ ] **Step 5: Typecheck**

Run: `pnpm -F @proj-airi/core-agent typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.test.ts
git commit -m "feat(core-agent): keep partial reply and suppress failure on barge-in abort"
```

---

### Task 3: `useBargeIn` composable

Owns a Silero VAD instance on the mic stream and, on speech-start, fires the injected stop actions when neru is busy.

**Files:**
- Create: `packages/stage-ui/src/composables/audio/use-barge-in.ts`
- Test: `packages/stage-ui/src/composables/audio/use-barge-in.test.ts`

**Interfaces:**
- Produces:
  - `shouldBargeIn(isBusy: boolean): boolean`
  - `useBargeIn(micStream: MaybeRefOrGetter<MediaStream | undefined>, actions: BargeInActions): void`
  - `interface BargeInActions { isBusy: () => boolean, stopSpeaking: () => void, abortStream: () => void }`
- Consumes: `useVAD` from `../../stores/ai/models/vad` (signature: `useVAD(workerUrl, { onSpeechStart, ... }) => { init(): Promise<void>, start(stream: MediaStream): Promise<void>, dispose(): void, ... }`); the VAD worklet URL `../../workers/vad/process.worklet?worker&url`.

- [ ] **Step 1: Write the failing test**

Create `packages/stage-ui/src/composables/audio/use-barge-in.test.ts`:

```ts
// neru barge-in 컴포저블 테스트 — VAD 워커는 목으로 대체하고 게이팅만 검증한다
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

// useVAD를 목으로: onSpeechStart 콜백을 붙잡아 워커 없이 발동만 검증한다.
const vadMock = vi.hoisted(() => ({ onSpeechStart: undefined as undefined | (() => void) }))
vi.mock('../../stores/ai/models/vad', () => ({
  useVAD: (_url: string, opts: { onSpeechStart?: () => void }) => {
    vadMock.onSpeechStart = opts.onSpeechStart
    return { init: vi.fn(async () => {}), start: vi.fn(async () => {}), dispose: vi.fn() }
  },
}))
// Vite 워커 URL import를 목으로 대체(테스트에서 워커 번들 해석 회피).
vi.mock('../../workers/vad/process.worklet?worker&url', () => ({ default: 'worklet-url' }))

const { shouldBargeIn, useBargeIn } = await import('./use-barge-in')

describe('shouldBargeIn', () => {
  it('fires only when neru is busy', () => {
    expect(shouldBargeIn(true)).toBe(true)
    expect(shouldBargeIn(false)).toBe(false)
  })
})

describe('useBargeIn', () => {
  beforeEach(() => { vadMock.onSpeechStart = undefined })

  function run(isBusy: boolean) {
    const stopSpeaking = vi.fn()
    const abortStream = vi.fn()
    const scope = effectScope()
    scope.run(() => useBargeIn(() => undefined, { isBusy: () => isBusy, stopSpeaking, abortStream }))
    return { stopSpeaking, abortStream }
  }

  it('stops speech and aborts the stream on speech-start when busy', () => {
    const { stopSpeaking, abortStream } = run(true)
    vadMock.onSpeechStart!()
    expect(stopSpeaking).toHaveBeenCalledTimes(1)
    expect(abortStream).toHaveBeenCalledTimes(1)
  })

  it('does nothing on speech-start when idle', () => {
    const { stopSpeaking, abortStream } = run(false)
    vadMock.onSpeechStart!()
    expect(stopSpeaking).not.toHaveBeenCalled()
    expect(abortStream).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/composables/audio/use-barge-in.test.ts`
Expected: FAIL — cannot resolve `./use-barge-in`.

- [ ] **Step 3: Write the composable**

Create `packages/stage-ui/src/composables/audio/use-barge-in.ts`:

```ts
// 사용자가 말하기 시작하면 neru의 발화·생성을 즉시 중단시키는 barge-in 컴포저블
import type { MaybeRefOrGetter } from 'vue'

import { onScopeDispose, toValue, watch } from 'vue'

import { useVAD } from '../../stores/ai/models/vad'
import workletUrl from '../../workers/vad/process.worklet?worker&url'

export interface BargeInActions {
  /** neru가 지금 말하거나(생성 포함) 있는지 — barge-in은 이 때만 발동한다. */
  isBusy: () => boolean
  /** TTS 재생 중단 요청(reason 'barge-in'). */
  stopSpeaking: () => void
  /** 진행 중 LLM 스트림 취소. */
  abortStream: () => void
}

/**
 * 발동 판정: neru가 바쁠 때만 끼어들기. 유휴 상태의 사용자 발화는 평소 입력이므로 무시한다.
 */
export function shouldBargeIn(isBusy: boolean): boolean {
  return isBusy
}

/**
 * 마이크 스트림에 Silero VAD를 물려, 사용자 발화 시작 시 neru가 바쁘면 TTS 중단 + LLM 취소를 발동한다.
 * 스트림이 없으면(음성 입력 off) VAD를 시작하지 않아 barge-in은 비활성이다.
 */
export function useBargeIn(micStream: MaybeRefOrGetter<MediaStream | undefined>, actions: BargeInActions): void {
  const { init, start, dispose } = useVAD(workletUrl, {
    onSpeechStart: () => {
      if (shouldBargeIn(actions.isBusy())) {
        actions.stopSpeaking()
        actions.abortStream()
      }
    },
  })

  // 마이크 스트림이 준비되면 VAD 모델을 로드하고 그 스트림으로 시작한다.
  watch(() => toValue(micStream), async (stream) => {
    if (!stream)
      return
    await init()
    await start(stream)
  }, { immediate: true })

  onScopeDispose(() => dispose())
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @proj-airi/stage-ui exec vitest run src/composables/audio/use-barge-in.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm -F @proj-airi/stage-ui typecheck` (exit 0), then
`node node_modules/eslint/bin/eslint.js packages/stage-ui/src/composables/audio/use-barge-in.ts packages/stage-ui/src/composables/audio/use-barge-in.test.ts` (no output = clean).

- [ ] **Step 6: Commit**

```bash
git add airi/packages/stage-ui/src/composables/audio/use-barge-in.ts airi/packages/stage-ui/src/composables/audio/use-barge-in.test.ts
git commit -m "feat(stage-ui): add useBargeIn composable (VAD speech-start gating)"
```

---

### Task 4: Wire barge-in into Stage.vue + `'barge-in'` stop reason

Adds the `'barge-in'` stop reason and instantiates `useBargeIn` in `Stage.vue` with real dependencies. Stage.vue is a large SFC and this is integration wiring; verification is typecheck + lint + a manual protocol (the gating and abort are already unit-tested in Tasks 1-3).

**Files:**
- Modify: `packages/stage-ui/src/stores/speech-output-control.ts`
- Modify: `packages/stage-ui/src/components/scenes/Stage.vue`

**Interfaces:**
- Consumes: `useBargeIn` (Task 3); `useChatOrchestratorStore().abortActiveStream` (Task 1); `useSpeechOutputControlStore().requestStopSpeaking` (existing); `useSettingsAudioDevice().stream` (existing mic stream).

- [ ] **Step 1: Add the `'barge-in'` stop reason**

In `packages/stage-ui/src/stores/speech-output-control.ts`, line 4:

```ts
export type SpeechOutputStopReason = 'manual-chat' | 'barge-in'
```

- [ ] **Step 2: Typecheck to confirm the union change compiles**

Run: `pnpm -F @proj-airi/stage-ui typecheck`
Expected: exit 0 (no consumer breaks — the `latestStopRequest` watcher handles all reasons identically).

- [ ] **Step 3: Wire `useBargeIn` in Stage.vue**

Add imports to `packages/stage-ui/src/components/scenes/Stage.vue` (grouped with existing imports; `useChatOrchestratorStore`, `useSpeechOutputControlStore`, `onMounted`, `onUnmounted`, `storeToRefs` are ALL already imported — do not duplicate them). Add only these two, using relative paths to match Stage.vue's intra-package import convention:

```ts
import { useBargeIn } from '../../composables/audio/use-barge-in'
import { useSettingsAudioDevice } from '../../stores/settings/audio-device'
```

Where the stores are set up (near lines 91-96), bind the mic stream, the `sending` ref, and the stop actions. `nowSpeaking` is already bound at line 91; `useChatOrchestratorStore()` is already called at line 96 (destructures hook registrations) — add `sending` via `storeToRefs` and grab `abortActiveStream`:

```ts
const { stream: micStream } = storeToRefs(useSettingsAudioDevice())
const chatOrchestrator = useChatOrchestratorStore()
const { sending } = storeToRefs(chatOrchestrator)
const speechOutputControl = useSpeechOutputControlStore()

useBargeIn(micStream, {
  isBusy: () => nowSpeaking.value || sending.value,
  stopSpeaking: () => speechOutputControl.requestStopSpeaking('barge-in'),
  abortStream: () => chatOrchestrator.abortActiveStream(),
})
```

> `useBargeIn` registers `onScopeDispose` internally, so calling it in `setup()` ties VAD teardown to the component lifecycle automatically — no `onUnmounted` edit needed.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm -F @proj-airi/stage-ui typecheck` (exit 0), then
`node node_modules/eslint/bin/eslint.js packages/stage-ui/src/components/scenes/Stage.vue packages/stage-ui/src/stores/speech-output-control.ts` (clean).

- [ ] **Step 5: Manual verification (headphones)**

1. Launch the app: from `airi/`, `pnpm desktop` (background). Wait for the stage window + neru-audio gateway on :3457.
2. Enable voice input; speak to neru so she starts replying with voice.
3. **While neru is speaking, start talking.** Expected: her audio stops within roughly 300 ms; the partial reply she already spoke remains in the chat panel; your utterance becomes the next turn.
4. Ask something that takes a moment; **start talking while she is still "thinking"** (before audio). Expected: generation cancels, no error toast.
5. Speak while neru is idle. Expected: normal turn — no interrupt artifacts.
6. Shut the app down cleanly, preserving the LLM proxy on :3456.

- [ ] **Step 6: Commit**

```bash
git add airi/packages/stage-ui/src/components/scenes/Stage.vue airi/packages/stage-ui/src/stores/speech-output-control.ts
git commit -m "feat(stage-ui): wire barge-in into the stage (VAD -> stop TTS + abort LLM)"
```

---

## Notes for the final whole-branch review

- Confirm the abort path does not double-append the assistant message (normal finalize at lines 755-763 vs. the new abort branch — only one should run per send; the abort branch `return`s before `finally`).
- Confirm `micStream` (a VueUse `useUserMedia` ref) changing identity does not restart the VAD needlessly on every render — the `watch` fires only when the `MediaStream` reference changes.
- Confirm no error toast / failure analytics fires on an intentional barge-in (Task 2 gate).
