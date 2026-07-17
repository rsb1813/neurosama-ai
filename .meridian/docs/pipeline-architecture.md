---
summary: neru voice pipeline architecture — AIRI fork owns orchestration/avatar/subtitles; neru-audio gateway exposes GPU STT/TTS over OpenAI-compatible HTTP; bilingual routing splits English→TTS, Korean→display via <ko> segment-boundary slicing; emotion→exp3 expression wiring drives the witch avatar's face from LLM emotions (one at a time, hold+auto-reset); barge-in interrupts neru via client-side Silero VAD → TTS stop + LLM stream abort; neru persona card embeds ACT emotion-token protocol + witch backstory; cross-window Pinia store isolation affects the settings panel but not the stage window where driving happens
read_when:
  - understanding how AIRI, the local LLM proxy, and the neru-audio gateway fit together
  - adding or modifying the neru-audio FastAPI endpoints (/v1/audio/speech, /v1/audio/transcriptions)
  - debugging the Electron auto-spawn/tree-kill of the neru-audio gateway
  - debugging provider connection/onboarding (neruPreseed.ts localStorage keys)
  - debugging the bilingual output routing (English voice vs Korean display/subtitle)
  - debugging the streaming speech extraction (segment-boundary slicing, filterToSpeech bug history)
  - debugging the caption overlay BroadcastChannel cross-window delivery
  - debugging the emotion→expression wiring (applyEmotion, exp3 registration, cross-window store isolation)
  - understanding the witch expression catalog (which exp3 are facial vs props)
  - working on CUDA/Blackwell DLL loading shared by Chatterbox TTS and faster-whisper STT
  - working on the neru persona card or system prompt
  - debugging barge-in (VAD trigger, TTS stop, LLM abort, partial-reply persistence)
  - understanding how the in-flight LLM stream abort works (AbortController in chat-orchestrator-runtime)
  - looking for the removed self-built backend/frontend (orchestrator, provider ABCs, VTubeStudioAvatar) — see "Removed" section below
---

# neru Voice Pipeline Architecture

## Current architecture: AIRI fork + neru-audio gateway

neru is now a single system: the vendored **Project AIRI fork** (`airi/`) plus a small Python **neru-audio** gateway that exposes our GPU voice tech over HTTP. There is no self-built orchestrator or frontend anymore — both were deleted (see "Removed: self-built backend/frontend" below); AIRI performs that role natively.

```
Korean mic (captured by AIRI) → AIRI STT orchestration → neru-audio POST /v1/audio/transcriptions
   (faster-whisper large-v3, ko) → AIRI conversation loop → LLM proxy (localhost:3456, OpenAI-compatible)
   → Claude reply → AIRI → neru-audio POST /v1/audio/speech (Chatterbox, Neuro-cloned voice)
   → AIRI Live2D avatar lip-sync + AIRI subtitle overlay
```

AIRI owns: mic capture, STT orchestration/turn-taking, the LLM conversation loop, the Live2D avatar (rendering + lip-sync), and subtitles — all via AIRI's own existing code, not ours. Barge-in (user interrupts neru) was added by us on top of AIRI's primitives (see Barge-in section below).

`neru-audio` (`airi/services/neru-audio/`) owns only GPU-accelerated STT and TTS, exposed as plain OpenAI-compatible HTTP endpoints so AIRI's existing `openai-compatible-audio-*` providers can call them with zero AIRI code changes.

## Providers (AIRI side — config only, no custom code)

All three point at local services via `neruPreseed.ts` (`airi/apps/stage-tamagotchi/src/renderer/neruPreseed.ts`), which **authoritatively** seeds localStorage before AIRI's stores hydrate so onboarding is skipped. "Authoritative" means scalar keys (active-provider, active-model, `settings/live2d/expression-enabled`) are **overwritten every launch** (not write-only-if-absent), and shared object keys (credentials, providers/added) are **merged** preserving the rest of the catalog. This overcomes stale AIRI defaults in dev localStorage that would otherwise leave providers unbound. Tradeoff: UI provider switches revert next launch — intended for a single-purpose appliance. The stage-model preseed uses a sentinel key (`neru/stage-model-seeded`) so the witch model is seeded once but the user's later model choice is respected:

| Role | AIRI provider id | Base URL | Backing service |
|------|------------------|----------|-----------------|
| LLM | `openai-compatible` | `http://localhost:3456/v1/` | pre-existing local Anthropic-format proxy (not our code) |
| STT | `openai-compatible-audio-transcription` | `http://localhost:3457/v1/` | `neru-audio` → faster-whisper large-v3 |
| TTS | `openai-compatible-audio-speech` | `http://localhost:3457/v1/` | `neru-audio` → Chatterbox (Neuro-cloned voice) |

## neru-audio gateway (`airi/services/neru-audio/`)

FastAPI app (`neru_audio/app.py`), binds `127.0.0.1:3457`:

- `GET /v1/models` — minimal model list for clients that probe it.
- `POST /v1/audio/speech` — OpenAI Audio Speech shape (`{model, input, response_format?}`) → Chatterbox-synthesized audio (WAV by default; raw PCM16 24kHz on `response_format:"pcm"`). Serialized behind an `asyncio.Lock` — concurrent calls into the same CUDA model would corrupt audio or risk OOM.
- `POST /v1/audio/transcriptions` — OpenAI Audio Transcriptions shape (multipart `file`, optional `language`/`response_format`) → faster-whisper `large-v3` transcription, decoded via PyAV so any container (webm/wav) works; defaults to `language=ko`. The model lazy-loads once per process behind its own `asyncio.Lock`.

### Security middleware (`_restrict_to_local_app`)

All `/v1/*` endpoints are gated by an HTTP middleware enforcing: **Host allowlist** (DNS-rebinding defense), **Origin allowlist** (localhost/127.0.0.1 only, via `_origin_allowed` — single gate for both preflight and real requests), **Bearer token** (`Authorization: Bearer <NERU_API_KEY>`), and **Content-Length cap** (25 MB).

**CORS preflight**: the AIRI Electron renderer calls the gateway cross-origin (dev origin `http://localhost:<vite-port>` → `127.0.0.1:3457`). Browsers send an `OPTIONS` preflight that cannot carry `Authorization`. The middleware short-circuits `OPTIONS` with `204 + CORS headers` for allowed origins only (else `403`), without requiring auth. Real (non-OPTIONS) requests still require the Bearer token and all other checks. Internet origins are browser-enforced (non-spoofable) and rejected — drive-by defense preserved. Real responses carry only `Access-Control-Allow-Origin` + `Vary: Origin` (other CORS headers are preflight-only).

Both the Chatterbox and faster-whisper models load in the **same process**, so the Blackwell/sm_120 CUDA DLL story applies directly: `gpu.py`'s `_ensure_cuda_dll_path()` prepends `torch/lib` to `PATH` so CTranslate2 finds `cublas64_12.dll`/`cudnn64_9.dll` without a separate nvidia-* wheel (native delay-load consults `PATH`, not `add_dll_directory` alone). This file, plus `tts.py` (from the old `tts/chatterbox_local.py`) and `app.py` (from the old `bridge/openai_audio.py`), were ported near-verbatim from the deleted `backend/`.

Run standalone: `uv run neru-audio` (from `airi/services/neru-audio/`; entry point `neru_audio.app:main` via `pyproject.toml`'s `[project.scripts]`).

## Electron auto-spawn/tree-kill (`apps/stage-tamagotchi/src/main/services/neru-audio/index.ts`)

The desktop app (`pnpm desktop`, run from `airi/`) spawns `uv run neru-audio` as a child process on launch — **dev only** (`is.dev` gate; packaged builds have no bundled Python, see Known Issue below) — and polls `GET http://127.0.0.1:3457/v1/models` for up to 60s to confirm readiness. On quit it tree-kills the child: `taskkill /pid <pid> /T /F` on Windows (a plain `child.kill()` only kills the immediate `uv`/`cmd` wrapper, leaving the actual Python process alive), `child.kill()` on other platforms. Spawn failure (e.g. `uv` not found) is caught via the child's `error` event so it can't crash the Electron main process.

**Known issue:** packaged `airi.exe` has no Python runtime, so auto-spawn is a no-op in packaged mode (a warning is logged instead). Bundling a Python runtime/venv into the packaged app is an open follow-on decision.

## Removed: self-built backend/frontend (historical reference)

The root `backend/` (Python orchestrator with a turn-taking state machine + barge-in cancellation, `STTProvider`/`LLMProvider`/`TTSProvider`/`AvatarDriver` ABCs, `ClaudeLLM`, `WhisperLocalSTT`, `ChatterboxTTS`, `VTubeStudioAvatar` — pyvts direct mouth-parameter injection lip-sync) and `frontend/` (Vite + pixi.js web-native Live2D renderer + Electron overlay) were **deleted** in this integration (commit `9ebc01e`, "chore: remove parallel self-built backend and frontend"). AIRI now performs orchestration, avatar rendering, and subtitles natively, making that code redundant except for the GPU voice tech, which was ported into `neru-audio` (see above). None of the classes, event types, or state-machine behavior described in earlier revisions of this document exist in this repo anymore; they're preserved only in git history.

## Language Flow (bilingual routing — implemented)

## Emotion → Expression (Live2D exp3 wiring — M-E Phase 2)

The witch Live2D model has 12 `.exp3.json` expressions. **7 are facial** (heart-eyes `x`→happy, star-eyes `xx`→surprised/curious, angry-brow `sq`→angry, soft-worry `ku`→sad, blush `h`→awkward, glasses `yj`→think/question, shadow-eyes `hdj`→sinister/unused). **5 are prop/costume toggles** (gamepad `zs1`, mic `zs2`, ghosts `cw`, staff `fz`, hat-off `mz`) excluded from the emotion map.

Data flow: LLM emotion token → `Stage.vue` emotion queue → Live2D branch calls `expressionStore.applyEmotion(EMOTION_Live2DWitchExpressionName_value[emotion])` → resets previous group to `modelDefault` → activates mapped exp3 group params to their target values → `applyExpressions` (per-frame motion plugin) writes values to the Cubism core model → hold ~4s → auto-reset to neutral via `applyValue`'s duration timer (reset target = `modelDefault`, not `defaultValue`, to prevent drift if `saveDefaults()` is called during an active emotion).

Key files: `packages/stage-ui/src/constants/emotions.ts` (witch map), `packages/stage-ui-live2d/src/stores/expression-store.ts` (`applyEmotion` action), `packages/stage-ui/src/components/scenes/Stage.vue` (one-line hook in the Live2D emotion branch). The map is witch-specific (`EMOTION_Live2DWitchExpressionName_value`); models with no registered expressions see a no-op.

### Cross-window expression store isolation (known issue)

The expression store (`useExpressionStore`, Pinia id `live2d-expressions`) is **renderer-local**: each BrowserWindow has its own isolated Pinia instance. The Live2D model runs in the **main stage window** and registers all 12 exp3 groups there (runtime-verified: `registerExpressions groups=12`, all exp3 fetch 200). The expression **settings panel** (`model-settings/live2d.vue`) runs in the **settings BrowserWindow** (`windows/settings/`, separate `new BrowserWindow`, route `/settings/models`) with its own empty store — no model runs there, so it shows "No expressions available." `createPinia()` is plain (no cross-window sync plugin; only chat has `chat-sync`). This does NOT affect emotion→expression driving (it happens entirely in the stage window). A future fix would broadcast registered groups via eventa IPC stage→settings.

### Expression system prerequisite

AIRI's Live2D expression system is **off by default** (`settings/live2d/expression-enabled = false`). When disabled, `initExpressionController` in `Model.vue` does not create `internalModelRef`, so expressions are never registered and `applyEmotion` is a no-op. `neruPreseed.ts` seeds this key to `true` on every launch so the witch's expressions always register.

- STT: faster-whisper (`neru-audio`) transcribes Korean mic input → Korean text.
- LLM: Claude (via the local proxy) generates the reply. The neru persona card (`packages/stage-ui/src/constants/neru-persona.ts`, preseeded by `neruPreseed.ts`) instructs the LLM to reply in the format `English sentence <ko>한국어 번역</ko>` per sentence.
- **Bilingual routing** (`packages/core-agent/src/runtime/chat-orchestrator-runtime.ts`): `createStreamingCategorizer` detects completed `<ko>` segments. English text (outside tags) is extracted via segment-boundary slicing (not the broken `filterToSpeech`) and sent to TTS. Korean text (inside `<ko>`) is routed to the chat panel via `buildingMessage.content`/`slices` and to the caption overlay via `emitSubtitleHooks` → `onSubtitle` hook → `Stage.vue` → BroadcastChannel `airi-caption-overlay`.
- TTS: Chatterbox (`neru-audio`) synthesizes the English speech with the Neuro-cloned voice.
- Avatar: AIRI's built-in Live2D renderer lip-syncs to audio segments.
- Chat panel: displays Korean (from `<ko>` content).
- Caption overlay: separate Electron window subscribing to the same BroadcastChannel. Currently not rendering (known issue under investigation — BroadcastChannel cross-window delivery or window render issue).

The speech extraction was originally `categorizer.filterToSpeech` per stream chunk, which dropped English preceding an opening `<ko>` when a chunk straddled the tag boundary (first 1-2 spoken sentences silently swallowed). Fixed in commits 5f11741 + d898ad1: replaced with segment-boundary slicing that emits English before each completed segment, skips reasoning-tag content, and flushes trailing English in onEnd (cut at first `<` to prevent incomplete tag leakage).

## neru Persona Card (`neru-persona.ts`)

`NERU_SYSTEM_PROMPT` (`packages/stage-ui/src/constants/neru-persona.ts`) is the sole system prompt for neru's card. It combines four concerns in one constant:

1. **Personality/backstory**: witty, playful, warm goblin-witch VTuber. A little digital witch who woke up in a machine, wears a pointy black star hat, has ghost familiars, improvises her past.
2. **Bilingual output format** (STRICT): English sentences + `<ko>한국어</ko>` translation per sentence.
3. **ACT emotion-token protocol** (REQUIRED): `<|ACT {"emotion":"..."}|>` tokens that drive the on-screen face. Without this protocol in the prompt, the LLM never emits emotion tokens and the expression wiring is inert. The available-emotions list is generated from `EMOTION_PROMPT_LIST` (`packages/stage-ui/src/constants/emotions.ts`), shared with the default card's `SystemPromptV2` so both stay in sync.
4. **Emotion pacing**: instructs one emotion per short reply to prevent per-sentence face flickering.

The `<|ACT|>` (special marker, `<|` delimiter) and `<ko>` (literal, `<` delimiter) token formats are parsed by different stages and don't collide — the marker parser strips ACT tokens first, then downstream subtitle slicing handles `<ko>`.

The card is preseeded as active by `neruPreseed.ts` (key `airi-card-active-id` = `'neru'`, overwritten every launch). The default AIRI card's `SystemPromptV2` description is never used when neru's card is active — so the ACT protocol MUST be in `NERU_SYSTEM_PROMPT` or emotions are dead.

## Barge-in (M-G) — interrupt neru by speaking

When the user starts speaking while neru is talking or generating, neru stops immediately. Assumes headphones (no acoustic echo cancellation needed).

### Architecture — three pieces

**1. In-flight LLM stream abort** (`packages/core-agent/src/runtime/chat-orchestrator-runtime.ts`)

A per-send `AbortController` is created after `setSending(true)` and its `abortSignal` is passed into the `deps.llm.stream(...)` options — the signal was already plumbed through `coreStreamFrom` to `streamText({ abortSignal })` but nothing ever provided a controller. `abortActiveStream()` calls `controller.abort()` and is exposed on the runtime return object and through `useChatOrchestratorStore` (`packages/stage-ui/src/stores/chat.ts`). The controller is cleared in `finally`.

On abort, the `performSend` `catch` block treats a graceful interruption (NOT a failure) as one whose caught error is an `AbortError` — discriminated by the error's identity via a local `isAbortError(error)`, deliberately NOT the sticky `activeAbortController?.signal.aborted` flag (that flag stays true for the rest of the send, so a post-stream success-path hook throw during a still-playing TTS tail would be misclassified as a barge-in and double-append the partial). On a real barge-in it appends the partial `buildingMessage` to the session (mirroring the normal finalize guard: `!isStaleGeneration() && buildingMessage.slices.length > 0`) and returns without firing `onChatActivationFailed`. The existing `AbortError` handling in `llm-service.ts` prevents error toasts.

**D3 nuance:** only closed `<ko>` segments populate `buildingMessage.slices`/`.content`. A barge-in landing mid-English-sentence before the first `<ko>` closes persists nothing — same guard as the normal finalize, not a regression. Ties to the bilingual-persistence gap known issue.

**2. `useBargeIn` composable** (`packages/stage-ui/src/composables/audio/use-barge-in.ts`)

Owns a client-side Silero VAD instance on the live mic `MediaStream` via `useVAD` (`packages/stage-ui/src/stores/ai/models/vad.ts`). The VAD uses its own 16kHz audio context and coexists with the STT consumer on the same `MediaStream`.

On `onSpeechStart` (~300ms latency, threshold 0.52, minSpeechDurationMs 300), evaluates `shouldBargeIn(actions.isBusy())` — a pure gate that returns `isBusy`. If true, fires `actions.stopSpeaking()` + `actions.abortStream()`. If false (neru idle), does nothing (normal input). Lifecycle: `watch(micStream)` → `init()` (loads ONNX model) → `start(stream)`; `onScopeDispose` → `dispose()`. No mic stream = VAD never starts = barge-in inert.

**3. Stage wiring** (`packages/stage-ui/src/components/scenes/Stage.vue` + `packages/stage-ui/src/stores/speech-output-control.ts`)

`SpeechOutputStopReason` union extended with `'barge-in'`. Stage.vue instantiates `useBargeIn(micStream, { isBusy, stopSpeaking, abortStream })` where:
- `micStream` = `useSettingsAudioDevice().stream` (same stream STT uses)
- `isBusy = () => nowSpeaking.value || sending.value`
- `stopSpeaking = () => requestStopSpeaking('barge-in')` → the existing stop path (halt AudioBufferSourceNode, drain sentence queue, cancel pending TTS, close WS)
- `abortStream = () => useChatOrchestratorStore().abortActiveStream()`

### Data flow

```
User speaks → Silero VAD speech-start (~300ms) → useBargeIn gate:
  nowSpeaking || sending?
    YES → requestStopSpeaking('barge-in') + abortActiveStream()
    NO  → ignore (normal STT input path)
→ user's utterance transcribed as next turn; partial reply kept in history
```
