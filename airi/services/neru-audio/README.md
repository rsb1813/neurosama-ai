# neru-audio

Local GPU audio gateway for the AIRI fork. Exposes OpenAI-compatible
`/v1/audio/speech` (Chatterbox, Neuro-cloned voice) and
`/v1/audio/transcriptions` (faster-whisper large-v3, Korean) on
`127.0.0.1:3457`. Auto-spawned by the Electron desktop app in dev via
`uv run neru-audio`.
