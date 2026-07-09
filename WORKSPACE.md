# Workspace

### neru — AI VTuber (Neuro-sama clone)
Real-time voice conversation core: Korean speech in → English voice out + Korean subtitles.

**Done:** M1 (skeleton), M3 (Claude LLM), M4 (Chatterbox TTS + Neuro clone), M2 (faster-whisper STT). All reviewed (code + health). Avatar pivoted to **web-native Live2D** — renders in Vite frontend (Playwright validated). **Electron overlay** (transparent, frameless, always-on-top, bottom-right corner, draggable) — AIRI style. **HiDPI render + AIRI movement/settings**: devicePixelRatio+autoDensity, cursor look-at, idle motion, auto blink/breath/physics, expression switching, settings panel (localStorage) + click-through IPC bridge (preload).

**Next:** WebSocketAvatar + ws_server → frontend WS client for real lip-sync (drive `window.__setMouth`) + subtitles.

**Known Issues:**
- Orchestrator `stop_speaking` drain/close wiring needed for M5.
- STT+TTS CUDA DLL coexistence unverified in single process.
- Default mic = Steam Streaming (device 1); real mic = Realtek (device 20) → `NEURU_STT_DEVICE_INDEX`.

**Key Decisions:**
- Avatar = web-native Live2D + Electron overlay (rejected VTS — user preference). Cubism **4** Core required (v5 crashes renderer).
- Blackwell/sm_120: torch cu128 (TTS) + CTranslate2 reusing torch/lib DLLs (STT).
- TTS = Chatterbox; STT = faster-whisper large-v3 + silero VAD.

**Next Steps:**
1. WebSocketAvatar + ws_server: push amplitude/subtitle/state → frontend WS client for real lip-sync (call `window.__setMouth`) + subtitles.
2. M5: full pipeline wiring (STT→LLM→TTS→avatar), drain/close debts.
