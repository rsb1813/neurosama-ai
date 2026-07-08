---
summary: neru voice pipeline architecture — provider interfaces, orchestrator barge-in, event flow
read_when:
  - adding a new provider (STT, LLM, TTS, avatar)
  - modifying the orchestrator or turn-taking logic
  - debugging barge-in or cancellation behavior
  - understanding the pipeline event flow
  - working with ClaudeLLM, persona prompt, or EN/KO streaming format
---

# neru Voice Pipeline Architecture

## Pipeline Flow

```
Korean mic → VAD → local STT(ko) → orchestrator → Claude(en reply + ko subtitle)
   → local TTS(en) → speaker/virtual cable → VTube Studio auto lip-sync
                                            → frontend Korean subtitle overlay
   ↑ VAD re-detects user speech → barge-in: cancel TTS + LLM stream
```

## Provider Interfaces

All providers sit behind thin abstract bases in `backend/src/neru/{stt,llm,tts,avatar}/base.py`. The orchestrator depends only on these bases — never on concrete implementations. This is deliberate for swappability (not over-engineering).

| Provider | Base class | `run`/method signature | Notes |
|----------|-----------|----------------------|-------|
| STT | `STTProvider` | `async run(out: Queue)` — pushes `SpeechStarted`/`Transcript` events | Long-running; cancelled to stop |
| LLM | `LLMProvider` | `async stream_reply(text_ko, history) -> AsyncIterator[ReplyChunk]` | Yields `(speech_en, subtitle_ko)` pairs |
| TTS | `TTSProvider` | `async synthesize(text_en) -> AsyncIterator[bytes]` | Audio chunks; first chunk ASAP |
| Avatar | `AvatarDriver` | `connect()`, `start_speaking()`, `feed_audio(chunk)`, `stop_speaking()` | Controls lip-sync lifecycle |

`OutputSink` is a `Protocol` (structural typing), not an ABC — it's an external boundary (WebSocket server, test recorder), not an internal engine. This distinction is intentional.

## Event Types (`events.py`)

- `SpeechStarted` — VAD detected user speech onset
- `Transcript(text, is_final)` — STT transcription; only `is_final=True` triggers response
- `ReplyChunk(speech_en, subtitle_ko)` — one incremental piece of LLM reply
- `Shutdown` — graceful termination sentinel
- `Event` — union type of the above three queue-bound events

## Orchestrator State Machine

States: `LISTENING` → `THINKING` → `SPEAKING` → `LISTENING`

### Normal path
1. `Transcript(is_final=True)` arrives → cancel any prior response → spawn `_respond` task
2. `_respond`: set THINKING → stream LLM chunks → on first chunk: avatar `start_speaking` + set SPEAKING → stream TTS audio to avatar → on completion: `stop_speaking` + set LISTENING + append to history

### Barge-in (interruption)
`SpeechStarted` during SPEAKING/THINKING → `_cancel_response()` cancels the `_respond` task → task catches `CancelledError`, calls `_safe_end_speech` (avatar stop + LISTENING), re-raises. History is NOT updated for interrupted turns.

### Error recovery
Provider exceptions (network, timeout, auth) in `_respond` are caught by `except Exception`, logged, cleaned up via `_safe_end_speech`, and the pipeline continues (only the current turn is dropped). `_safe_end_speech` wraps cleanup in try/except so a failing avatar/sink can't crash the loop or mask CancelledError.

### Cancellation correctness
`_cancel_task` distinguishes child vs parent cancellation using `current_task().cancelling()` — child CancelledError is swallowed, but if the parent (run()) itself is cancelled (e.g. `wait_for` timeout), that cancellation is preserved and re-raised. Non-cancel task exceptions are logged (not silently swallowed).

`run()`'s finally block uses an **inner try/finally** around `_cancel_task(stt_task)` to guarantee `_cancel_response()` always executes — even when `_cancel_task` re-raises a sticky external CancelledError. Without this, the response task is orphaned as pending.

### Graceful shutdown
`Shutdown` event → `_drain_response()` awaits the in-flight response (no cancel) → return from consume loop. External cancellation during drain propagates normally.

## Concrete Providers (implemented)

### ClaudeLLM (`llm/claude.py`)
Uses `AsyncAnthropic` with `base_url` pointed at the local Anthropic-format proxy (`http://localhost:3456`). The proxy requires no real API key (SDK needs one → dummy `sk-local-proxy`).

The persona prompt (`persona.py`) instructs neru to output `EN: ...` / `KO: ...` line pairs per sentence. `ClaudeLLM._consume_line` parses the text stream line-by-line, buffering an EN line and emitting a `ReplyChunk` when the matching KO line arrives. First complete pair yields immediately for early TTS handoff.

Settings (`config.py`): `NEURU_LLM_BASE_URL`, `ANTHROPIC_API_KEY`, `NEURU_LLM_MODEL` — all env-configurable. Default model: `claude-opus-4-7` (highest available on the proxy; opus-4-8 is absent). Thinking param is omitted for low-latency direct replies.

### ChatterboxTTS (`tts/chatterbox_local.py`)
Resemble AI Chatterbox, local on the RTX 5080 (CUDA). Blocking `generate()` (~2s/sentence, RTF ~0.45 warm) is offloaded via `asyncio.to_thread`; the model loads once on first synthesis. Output is 24kHz mono PCM16 LE, chunked into `chunk_ms` (50ms) frames. Voice cloning via `audio_prompt_path` — defaults to the bundled Neuro-sama reference (`backend/assets/voices/neuro_ref.wav`); `NEURU_TTS_VOICE_PROMPT` overrides (empty = Chatterbox default voice).

Install note: torch/torchaudio are pinned to the cu128 index (Blackwell/sm_120); chatterbox's torch 2.6 pin is overridden. `setuptools<81` is required (perth watermarker imports `pkg_resources`). Python pinned `<3.13` so librosa→numba resolves to modern wheels.

### WhisperLocalSTT (`stt/whisper_local.py`)
faster-whisper (CTranslate2) `large-v3` + silero VAD, local on the RTX 5080. `run(out)` opens a sounddevice `InputStream` (16kHz mono, blocksize 512); the audio callback bridges frames to an asyncio queue via `loop.call_soon_threadsafe`. Silero `VADIterator` (512-sample chunks) drives segmentation: `'start'` → `SpeechStarted`, `'end'` → transcribe buffered audio (via `to_thread`) → `Transcript(is_final=True)`. `condition_on_previous_text=False` suppresses Whisper repetition loops. The `finally` block stops/closes the stream on cancel or exit.

CUDA-DLL note: CTranslate2 needs `cublas64_12.dll`/`cudnn64_9.dll`, which torch cu128 already bundles. `_ensure_cuda_dll_path()` prepends `torch/lib` to PATH (native delay-load consults PATH, not `add_dll_directory` alone) — so no separate nvidia-* wheels.

Settings (`config.py`): `NEURU_STT_MODEL_SIZE` (default `large-v3`), `NEURU_STT_DEVICE_INDEX` (mic device; empty = system default input).

### Avatar approach: web-native Live2D (current) vs VTube Studio (alternative)
The avatar is being rendered **web-native**: the `frontend/` (Vite + pixi.js 6 + pixi-live2d-display) renders the neru Live2D model in-browser and drives `ParamMouthOpenY` for lip-sync. This suits an AI VTuber (no human face to track) and merges the avatar with the subtitle frontend into one neru web app. Planned data flow: a `WebSocketAvatar` (AvatarDriver) plays TTS audio and pushes mouth amplitude / subtitle / state over WebSocket; the browser applies them. The `VTubeStudioAvatar` below is retained as an alternative behind the same ABC.

Frontend gotcha: pixi-live2d-display 0.4.0 needs the **Cubism 4** Core — the Cubism 5 Core (SDK5) loads the model but crashes the renderer in `doDrawModel`. The bundled `frontend/public/live2dcubismcore.min.js` is the v4 CDN core. The model (`frontend/public/models/neru-witch/`) is git-ignored (44MB, third-party).

### VTubeStudioAvatar (`avatar/vtube_studio.py`) — alternative
Direct-injection lip-sync via pyvts (no VB-Cable). `connect()` does the pyvts handshake + token auth (first run pops an "Allow" dialog in VTS). `start_speaking()` opens a sounddevice `OutputStream` and a 30Hz mouth-driver task; `feed_audio()` appends PCM16 to a playback buffer that the output callback drains in real time. The driver task reads the currently-playing block's RMS amplitude and injects it into the VTS `MouthOpen` parameter (`requestSetParameterValue` → `InjectParameterDataRequest`), scaled by `gain` (default 6.0) and EMA-smoothed. So the avatar owns real-time audio playback *and* lip-sync — the audio's playback rate paces the mouth. `stop_speaking()` stops promptly (good for barge-in); when VTS is not connected, param injection and close are skipped so playback still works headless.

Chosen over VB-Cable audio routing (which needs an admin install + a running VTS mic pipeline); direct injection is self-contained and controllable. Token file `pyvts_token.txt` is git-ignored.

`stop_speaking(drain=False)` stops immediately (barge-in); `drain=True` waits for the playback buffer to drain first (normal completion). The output callback only consumes whole samples (even byte counts) so a stray odd-length chunk can't crash the audio thread, and the mouth-driver task logs-and-continues on a transient VTS request error instead of dying.

**M5 caveat:** the orchestrator must call `stop_speaking(drain=True)` on normal turn completion and `stop_speaking()` (abort) on barge-in — it currently calls the no-arg form for both. Teardown (`close()`) is also not yet in the `AvatarDriver` ABC / orchestrator path.

## Language Flow

- STT: Whisper Korean mode → Korean text
- LLM: single Claude call produces `{speech_en, subtitle_ko}` (not separate translation)
- TTS: English text only → English audio
- Frontend: Korean subtitle overlay via WebSocket
