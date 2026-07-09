---
summary: neru voice pipeline architecture — AIRI fork owns orchestration/avatar/subtitles; neru-audio gateway exposes GPU STT/TTS over OpenAI-compatible HTTP
read_when:
  - understanding how AIRI, the local LLM proxy, and the neru-audio gateway fit together
  - adding or modifying the neru-audio FastAPI endpoints (/v1/audio/speech, /v1/audio/transcriptions)
  - debugging the Electron auto-spawn/tree-kill of the neru-audio gateway
  - debugging provider connection/onboarding (neruPreseed.ts localStorage keys)
  - working on CUDA/Blackwell DLL loading shared by Chatterbox TTS and faster-whisper STT
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

AIRI owns: mic capture, STT orchestration/turn-taking/barge-in, the LLM conversation loop, the Live2D avatar (rendering + lip-sync), and subtitles — all via AIRI's own existing code, not ours.

`neru-audio` (`airi/services/neru-audio/`) owns only GPU-accelerated STT and TTS, exposed as plain OpenAI-compatible HTTP endpoints so AIRI's existing `openai-compatible-audio-*` providers can call them with zero AIRI code changes.

## Providers (AIRI side — config only, no custom code)

All three point at local services via `neruPreseed.ts` (`airi/apps/stage-tamagotchi/src/renderer/neruPreseed.ts`), which seeds localStorage before AIRI's stores hydrate so onboarding is skipped:

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

Both the Chatterbox and faster-whisper models load in the **same process**, so the Blackwell/sm_120 CUDA DLL story applies directly: `gpu.py`'s `_ensure_cuda_dll_path()` prepends `torch/lib` to `PATH` so CTranslate2 finds `cublas64_12.dll`/`cudnn64_9.dll` without a separate nvidia-* wheel (native delay-load consults `PATH`, not `add_dll_directory` alone). This file, plus `tts.py` (from the old `tts/chatterbox_local.py`) and `app.py` (from the old `bridge/openai_audio.py`), were ported near-verbatim from the deleted `backend/`.

Run standalone: `uv run neru-audio` (from `airi/services/neru-audio/`; entry point `neru_audio.app:main` via `pyproject.toml`'s `[project.scripts]`).

## Electron auto-spawn/tree-kill (`apps/stage-tamagotchi/src/main/services/neru-audio/index.ts`)

The desktop app (`pnpm desktop`, run from `airi/`) spawns `uv run neru-audio` as a child process on launch — **dev only** (`is.dev` gate; packaged builds have no bundled Python, see Known Issue below) — and polls `GET http://127.0.0.1:3457/v1/models` for up to 60s to confirm readiness. On quit it tree-kills the child: `taskkill /pid <pid> /T /F` on Windows (a plain `child.kill()` only kills the immediate `uv`/`cmd` wrapper, leaving the actual Python process alive), `child.kill()` on other platforms. Spawn failure (e.g. `uv` not found) is caught via the child's `error` event so it can't crash the Electron main process.

**Known issue:** packaged `airi.exe` has no Python runtime, so auto-spawn is a no-op in packaged mode (a warning is logged instead). Bundling a Python runtime/venv into the packaged app is an open follow-on decision.

## Removed: self-built backend/frontend (historical reference)

The root `backend/` (Python orchestrator with a turn-taking state machine + barge-in cancellation, `STTProvider`/`LLMProvider`/`TTSProvider`/`AvatarDriver` ABCs, `ClaudeLLM`, `WhisperLocalSTT`, `ChatterboxTTS`, `VTubeStudioAvatar` — pyvts direct mouth-parameter injection lip-sync) and `frontend/` (Vite + pixi.js web-native Live2D renderer + Electron overlay) were **deleted** in this integration (commit `9ebc01e`, "chore: remove parallel self-built backend and frontend"). AIRI now performs orchestration, avatar rendering, and subtitles natively, making that code redundant except for the GPU voice tech, which was ported into `neru-audio` (see above). None of the classes, event types, or state-machine behavior described in earlier revisions of this document exist in this repo anymore; they're preserved only in git history.

## Language Flow

- STT: faster-whisper (`neru-audio`) transcribes Korean mic input → Korean text.
- LLM: Claude (via the local proxy) generates the reply.
- TTS: Chatterbox (`neru-audio`) synthesizes the Neuro-cloned voice.
- Avatar + subtitles: AIRI's built-in Live2D renderer and chat/subtitle UI.
- The original neru signature (English voice + Korean subtitle, single LLM call producing both) is **not yet wired into AIRI** — it's a follow-on spec. The identity is preserved in `docs/superpowers/specs/neru-persona-reference.md` pending a character-card implementation.
