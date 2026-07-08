# neru

An AI VTuber (in the spirit of Neuro-sama) with a real-time voice conversation core.

You speak Korean into the mic; **neru replies in an English voice** (streamed via TTS) while
Korean subtitles appear on screen, and a Live2D avatar lip-syncs to the speech. Barge-in is
supported: start talking and neru stops immediately.

This is a hybrid stack — a Python backend for the STT → LLM → TTS pipeline and avatar control,
plus a TypeScript frontend for subtitles and a status dashboard.

## Status

**Milestone 1 (done):** pipeline skeleton with swappable provider interfaces (STT / LLM / TTS /
avatar), a turn-taking orchestrator with barge-in, and mock providers so the whole loop runs and
is unit-tested. Real STT, Claude, ElevenLabs, and VTube Studio integrations land in later
milestones. See `.meridian/plans/neru-mvp-voice-core.md` for the full roadmap.

## Layout

```
backend/    Python pipeline (uv project, src layout under src/neru)
frontend/   TypeScript UI (subtitles + dashboard) — added in a later milestone
```

## Backend: run & test

Requires Python 3.11+ and [uv](https://docs.astral.sh/uv/).

```bash
cd backend
uv venv
uv pip install -e ".[dev]"
uv run pytest            # run tests
uv run python -m neru.main   # run the mock pipeline demo
```

## Configuration

Copy `.env.example` to `.env` and fill in API keys once cloud providers are wired up. The `.env`
file is git-ignored — never commit real keys.
