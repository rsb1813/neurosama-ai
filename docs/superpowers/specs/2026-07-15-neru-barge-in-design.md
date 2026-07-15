<!-- neru barge-in(끼어들기) 설계 스펙 — 사용자가 말하기 시작하면 neru가 즉시 발화·생성을 멈춘다 (M-G) -->
# neru Barge-in (M-G) — Design Spec

**Status:** Approved design (2026-07-15). Branch: `feat/neru-barge-in`. Next: implementation plan (writing-plans).

## Goal

When the user starts speaking while neru is talking or generating a reply, neru stops immediately: TTS audio halts, the in-flight LLM stream is cancelled, and the app returns to listening so the user's speech becomes the next turn. This is a core MVP requirement ("내가 말하기 시작하면 neru가 즉시 말을 멈춘다").

## Context & constraints

- Built on the vendored AIRI fork (`airi/`). Voice input is already working (mic → local STT gateway `neru-audio` at :3457 → chat). LLM is the local proxy at :3456.
- **Audio setup: headphones/earphones** — neru's TTS output does not bleed into the mic, so acoustic echo cancellation and TTS-time VAD gating are NOT needed for this milestone. (If speaker use is added later, echo handling becomes a follow-up.)
- Codebase exploration (2026-07-15) established the barge-in readiness map:
  - **Stop TTS = ready to reuse.** `requestStopSpeaking(reason)` (`packages/stage-ui/src/stores/speech-output-control.ts`) → `stopSpeechOutput` (`packages/stage-ui/src/components/scenes/Stage.vue:639`) already halts the current `AudioBufferSourceNode`, drains the queued sentences, cancels pending TTS synthesis, and closes the streaming WebSocket.
  - **Cancel LLM stream = must build.** `abortSignal` is threaded to `streamText` (`packages/core-agent/src/runtime/llm-service.ts:225`) but no `AbortController` is ever created/passed for a send; `cancelPendingSends` only drops not-yet-started queued sends.
  - **Trigger = must build.** Client-side Silero VAD exists (`useVAD` in `packages/stage-ui/src/stores/ai/models/vad.ts`) but only runs on the hearing settings page; nothing in the live loop subscribes to its speech-start signal.
  - No existing barge-in; no unified turn-state machine.

## Success criteria

- Speaking into the mic (headphones) while neru is talking stops her audio within roughly the VAD's speech-start latency (~300 ms).
- If neru is mid-generation (thinking, not yet speaking), starting to speak cancels the in-flight LLM stream.
- The user's interrupting speech is transcribed and becomes the next turn (no special "sorry, interrupted" handling).
- The partial reply neru already spoke/generated is **kept** in chat history (see Decision D3).
- When neru is idle (not speaking, not generating), speaking is just normal input — no barge-in side effects.
- Text input continues to work unchanged; if voice input is off / no mic stream, barge-in is inert.

## Architecture — three pieces

### Piece 1 — LLM stream abort (core-agent runtime)

**File:** `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts` (+ expose through `packages/stage-ui/src/stores/chat.ts`).

- Hold one `activeAbortController: AbortController | undefined` in the runtime closure.
- In the send executor: create `activeAbortController = new AbortController()` when a send starts running (right after `setSending(true)`, ~line 419). Pass `abortSignal: activeAbortController.signal` into the `deps.llm.stream(...)` options object (~line 682); the signal is already honored downstream (`coreStreamFrom` → `streamText({ abortSignal })`). Clear `activeAbortController = undefined` in the completion/finally path.
- Add `abortActiveStream()` to the runtime's returned object (~line 891): calls `activeAbortController?.abort()`.
- Expose `abortActiveStream` through `useChatOrchestratorStore` (`chat.ts`), alongside the existing `cancelPendingSends`.
- `AbortError` is already recognized and handled cleanly (`llm-service.ts:106-110`), so an aborted stream does not surface as an error toast.

**Interface produced:** `useChatOrchestratorStore().abortActiveStream(): void`.

### Piece 2 — `useBargeIn` composable (new)

**File:** `packages/stage-ui/src/composables/audio/use-barge-in.ts`.

Owns the barge-in concern end to end: a Silero VAD instance on the mic stream + the gating decision.

- Signature (proposed): `useBargeIn(micStream: MaybeRefOrGetter<MediaStream | undefined>, actions: { isBusy: () => boolean, stopSpeaking: () => void, abortStream: () => void }): { active: Ref<boolean> }`.
- Instantiates `useVAD(workletUrl, { onSpeechStart })` (reusing `stores/ai/models/vad.ts`). Calls `init()` on mount (loads the ONNX model). When a `MediaStream` becomes available, calls `vad.start(stream)`. Disposes on unmount and when the stream goes away.
- On `onSpeechStart`: evaluate the pure predicate `shouldBargeIn(actions.isBusy())`; if true, call `actions.stopSpeaking()` and `actions.abortStream()`. If false, do nothing.
- `shouldBargeIn(isBusy: boolean): boolean` is a tiny exported pure helper (returns `isBusy`) so the gating is unit-testable without the VAD worker. (Kept as a named seam even though trivial today, because it is the one branch that decides whether an interrupt fires.)

**Why a dedicated composable (not inline in Stage.vue):** Stage.vue is already large; barge-in is a self-contained concern with its own lifecycle (VAD load/start/dispose) and one clear decision. Isolating it keeps Stage.vue thin and makes the gating testable.

### Piece 3 — Stage wiring

**File:** `packages/stage-ui/src/components/scenes/Stage.vue` and `packages/stage-ui/src/stores/speech-output-control.ts`.

- Add `'barge-in'` to the `SpeechOutputStopReason` union (`speech-output-control.ts:4`). No other change to the stop machinery — the existing `latestStopRequest` watcher in Stage.vue handles every reason identically.
- In Stage.vue, call `useBargeIn(micStreamRef, { isBusy, stopSpeaking, abortStream })` where:
  - `micStreamRef` = the active mic stream already used for STT (`audioDeviceSettingsStore.stream`). The VAD reads the same `MediaStream` as the STT consumer; the VAD uses its own 16 kHz audio context, so the two coexist.
  - `isBusy = () => nowSpeaking.value || sending.value` (`nowSpeaking` from `useSpeakingStore`; `sending` from `useChatOrchestratorStore`).
  - `stopSpeaking = () => useSpeechOutputControlStore().requestStopSpeaking('barge-in')`.
  - `abortStream = () => useChatOrchestratorStore().abortActiveStream()`.

## Data flow

```
User starts speaking
  → Silero VAD 'speech-start' (~300 ms; threshold 0.52, minSpeechDurationMs 300)
  → useBargeIn gate: shouldBargeIn(isBusy())  where isBusy = nowSpeaking || sending
      true  → requestStopSpeaking('barge-in')   [existing path: stop AudioBufferSourceNode,
                                                  drain sentence queue, cancel pending TTS, close WS]
            + abortActiveStream()                [new: .abort() the in-flight LLM stream]
      false → ignore (normal input path handles it)
  → the user's utterance is transcribed by the existing STT path and becomes the next turn
```

## Decisions

- **D1 — Trigger = Silero VAD speech-start (not transcription-gated).** Barge-in must feel immediate; waiting for STT words would add latency. Headphones remove the self-echo false-trigger risk. Ambient-noise false positives are filtered by the Silero threshold/min-speech defaults and are acceptable for MVP (threshold is tunable).
- **D2 — Logic lives in a dedicated `useBargeIn` composable**, not inline in Stage.vue (see Piece 2 rationale).
- **D3 — Intent: the partial reply neru already spoke/generated is kept in chat history.** Rationale: neru actually said/generated that much, so keeping it makes "what I just said" accurate for the next turn's context. **Not yet verified** that aborting the in-flight LLM stream persists the partial assistant message — the persist path runs in the chat orchestrator (`onStreamEnd`/`onAssistantResponseEnd`), and there is a known guard where an empty `buildingMessage.slices` skips saving (see WORKSPACE bilingual-persistence gap). The plan MUST verify what the abort path does to the building message and, if the partial is dropped, add explicit handling to persist what was already generated. A thinking-phase interrupt with zero generated content correctly saves nothing.
- **D4 — Gate on `nowSpeaking || sending`.** Barge-in fires both while speaking (TTS playing) and while thinking (LLM generating, before first audio). When idle, speech is normal input.

## Edge cases

- **No mic stream / voice input off:** `useBargeIn` never starts the VAD; barge-in is inert; text input unaffected.
- **Ambient noise:** filtered by Silero threshold 0.52 + minSpeechDurationMs 300. Tunable if twitchy in practice.
- **VAD model load latency:** `init()` runs at mount so the model is ready before the first turn; barge-in is inactive until loaded (fails safe — no interrupt rather than a wrong interrupt).
- **Abort race:** aborting an already-finished stream is a no-op (controller cleared on completion); `AbortError` is handled and does not toast.
- **Repeated speech-start while already interrupted:** `requestStopSpeaking` bumps a monotonic id so repeated requests still notify; a second abort on a cleared controller is a no-op. Harmless.

## Testing

- **Unit:**
  - `shouldBargeIn(isBusy)` — returns true only when busy.
  - Runtime abort: a send creates an `activeAbortController`, passes its signal to `deps.llm.stream`, clears it on completion; `abortActiveStream()` calls `.abort()`; an aborted stream resolves via the existing `AbortError` path (no error surface).
- **Integration-style:** mock the VAD `onSpeechStart` and the store getters/actions; assert `requestStopSpeaking('barge-in')` and `abortActiveStream()` are called on speech-start only when `isBusy()` is true, and neither is called when idle.
- **Manual (headphones):** speak while neru is talking → audio stops within ~300 ms; the partial reply remains in history; the spoken utterance becomes the next turn. Speak while neru is thinking → generation cancels. Speak while idle → normal turn, no interrupt artifacts.

## Out of scope (YAGNI)

- Acoustic echo cancellation / speaker-mode support (headphones assumption).
- A unified listening/thinking/speaking turn-state machine (not needed; gate on existing `nowSpeaking`/`sending`).
- "Sorry, you interrupted me" acknowledgements or resume-where-left-off.
- Configurable barge-in sensitivity UI (use VAD defaults; revisit only if false triggers show up in use).
