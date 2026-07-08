# Workspace

### neru — AI VTuber (Neuro-sama clone)
Real-time voice conversation core: Korean speech in → English voice out + Korean subtitles.

**Done:** M1 (skeleton), M3 (Claude LLM via proxy), M4 (Chatterbox TTS), M2 (faster-whisper STT), Neuro-sama voice clone wired as default.

**In Progress:** M2 live-mic test pending user (offline + mic-init verified). Next milestone: M6 (VTube Studio avatar lip-sync).

**Known Issues:**
- STT+TTS share one process → torch cudnn9 and CTranslate2 both load CUDA DLLs; watch for conflicts in M5 full-pipeline integration.
- Default mic is "Steam Streaming Microphone" (device 1); real mic likely Realtek (device 20) → `NEURU_STT_DEVICE_INDEX`.

**Key Decisions:**
- Blackwell/sm_120 VERIFIED: torch 2.9.0+cu128 (TTS) + CTranslate2 4.8.1 reusing torch/lib DLLs (STT). No separate nvidia CUDA wheels.
- TTS = Chatterbox (MIT, 5s zero-shot clone); rejected XTTSv2 (non-commercial CPML). STT = faster-whisper large-v3 + silero VAD (direct, not RealtimeSTT).
- Proxy serves opus-4-7/4-6, sonnet-4-6, haiku-4-5 (no opus-4-8) → default `claude-opus-4-7`.
- EN/KO tag-line format for LLM output; thinking param omitted for low latency.

**Next Steps:**
1. User: live-mic Korean test (`uv run python scripts/probe_stt.py`).
2. M6: VTube Studio avatar lip-sync (pyvts + VB-Cable audio routing).
3. M5: full-pipeline wiring + barge-in round-trip latency (STT→LLM→TTS).
