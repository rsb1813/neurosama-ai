# Workspace

### neru — AI VTuber (Neuro-sama clone)
Real-time voice conversation core: Korean speech in → English voice out + Korean subtitles.

**Done:** M1 (skeleton), M3 (Claude LLM via proxy), M4 (Chatterbox TTS), M2 (faster-whisper STT), M6 (VTube Studio avatar lip-sync via pyvts injection), Neuro-sama voice clone wired as default. All reviewed (code + health) and fixes applied.

**Pending user (live checks):** M2 live-mic Korean test; M6 live avatar test (launch VTS, click Allow). Both verified headless/offline.

**Next milestones:** M7 (TS subtitle frontend), M5 (full pipeline wiring + barge-in round-trip).

**Known Issues / M5 integration debts:**
- Orchestrator must call `avatar.stop_speaking(drain=True)` on normal completion, `stop_speaking()` on barge-in (currently no-arg for both); and call `avatar.close()` teardown (not yet in ABC/orchestrator).
- STT+TTS share one process → torch cudnn9 and CTranslate2 both load CUDA DLLs; watch for conflicts in M5.
- Default mic is "Steam Streaming Microphone" (device 1); real mic likely Realtek (device 20) → `NEURU_STT_DEVICE_INDEX`.

**Key Decisions:**
- Blackwell/sm_120 VERIFIED: torch 2.9.0+cu128 (TTS) + CTranslate2 4.8.1 reusing torch/lib DLLs (STT). No separate nvidia CUDA wheels.
- TTS = Chatterbox (MIT, 5s zero-shot clone); rejected XTTSv2 (non-commercial CPML). STT = faster-whisper large-v3 + silero VAD (direct, not RealtimeSTT).
- Proxy serves opus-4-7/4-6, sonnet-4-6, haiku-4-5 (no opus-4-8) → default `claude-opus-4-7`.
- EN/KO tag-line format for LLM output; thinking param omitted for low latency.

**Next Steps:**
1. User: live-mic Korean test (`uv run python scripts/probe_stt.py`) + live avatar test (`uv run python scripts/probe_avatar.py` with VTS running).
2. M7: TS subtitle frontend (ws_server + Vite overlay).
3. M5: full-pipeline wiring + barge-in round-trip latency (STT→LLM→TTS→avatar), applying the drain/close integration debts above.
