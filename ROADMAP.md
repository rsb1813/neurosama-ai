<!-- neru 전체 로드맵(비전 9개 + 현재 MVP 마일스톤 상태). 상세 진척은 checklist.md 참조. -->
# neru — Roadmap

The full product vision and its phased breakdown. This is the durable, in-repo
home for the roadmap so nothing feels "lost." Day-to-day status lives in
[`WORKSPACE.md`](WORKSPACE.md); granular MVP task tracking lives in
[`checklist.md`](checklist.md).

## Vision

Build **neru**, an AI VTuber at or beyond Neuro-sama's level. The full feature
set: real-time voice conversation, YouTube co-watching, game playing, chat
interaction, human-like computer control / coding / agency, long-term memory,
proactive speech, and multi-persona collaboration.

**Language flow (fixed):** the user speaks **Korean**; neru understands it and
replies in an **English voice** with **Korean subtitles** on screen, lip-synced
by a Live2D avatar.

**Architecture (fixed):** one desktop app = a vendored fork of
[Project AIRI](https://github.com/moeru-ai/airi) (avatar, chat, orchestration,
subtitles) + neru's own local **GPU voice stack** (`airi/services/neru-audio`:
Chatterbox TTS + faster-whisper STT, OpenAI-compatible) + a pre-existing local
OpenAI-compatible **LLM proxy** at `localhost:3456` (not our code — we point at it).

Each numbered subproject below gets its own spec → plan → implementation cycle.
We build **one vertical slice end-to-end, then expand** — so only #1 is active now.

## Subprojects

| # | Subproject | Status | Notes |
|---|------------|--------|-------|
| **1** | **Real-time voice conversation core** (MVP) | 🔄 **In progress** | STT→LLM→TTS streaming + barge-in + avatar lip-sync + subtitles. Milestone detail below. |
| 2 | Long-term memory | ✅ **Done** (PR #22) | `remember` LLM tool appends categorized facts to `MEMORY.md`; loaded at startup + injected into the prompt each turn for cross-session recall. Chose a plain markdown file over vector DB/RAG (YAGNI for current scale). Runtime-validated (save + recall across restart) and merged to master. |
| 3 | Proactive speech | ⬜ Planned | Idle-timer / event-driven prompter. |
| 4 | Chat integration | ⬜ Planned | Twitch / YouTube chat, treated as untrusted input. |
| 5 | Broadcasting | ⬜ Planned | OBS WebSocket compositing. |
| 6 | **Game agent** | ⬜ Planned | Neuro Game SDK–style text action protocol; per-game controllers. |
| 7 | **Computer control / coding agent** | ⬜ Planned | Human-like desktop control, built on Claude tool use. |
| 8 | **Multi-persona (Evil neru)** | ⬜ Planned | Separate souls (e.g. Evil neru) that talk **to each other**. |
| 9 | YouTube co-watching | ⬜ Planned | Watch-along. |

> Broadcasting (Twitch/YouTube/OBS) is explicitly **out of scope for the MVP**;
> the avatar is in scope.

## Phase 1 — Real-time voice core (MVP), milestone status

Success criterion: speak Korean into the mic → within ~1–3s neru answers in an
intelligible English voice, the Live2D avatar's mouth moves to it, and Korean
subtitles appear on screen; when the user starts talking, neru stops immediately
(barge-in).

| Milestone | Status |
|-----------|--------|
| M1 — Skeleton + provider interfaces (event bus, orchestrator, mocks) | ✅ Done |
| M2 — Local STT (faster-whisper large-v3 + Silero VAD, Korean) | ✅ Done (live-mic final check is the user's) |
| M3 — LLM connection (Claude via local proxy, persona, EN+KO output) | ✅ Done |
| M4 — Local TTS (Chatterbox, English voice on RTX 5080) | ✅ Done |
| **Pivot** → rebuild the frontend on **Project AIRI** (drop the self-built Vite/pixi front) | ✅ Done |
| ↳ AIRI vendored fork + run; LLM wired; desktop packaging; audio gateway (`neru-audio`); provider preseed | ✅ Done |
| **M-E — neru "witch" Live2D model in AIRI** | 🔄 **In progress (Phase 1 planned)** — model recovered (`~/Downloads/neru-witch-live2d.zip`); spec+plan for Phase 1 (render + auto blink/gaze/lip-sync + expression catalog) on `feat/neru-witch-avatar`. Phase 2 = emotion→expression wiring (not built in AIRI yet). |
| **M-F — Bilingual output (English voice + Korean subtitles)** ★core | ✅ **Done** (PR #18 merged) — persona card + `<ko>` categoriser + routing; two streaming-boundary bugs fixed with regression tests (core-agent 76/76). English voice + Korean chat panel verified. Caption-overlay window is a pre-existing AIRI infra issue, deferred (chat-panel Korean works). |
| **M-G — Full loop + barge-in** | ⬜ **Not started** — interrupt neru by speaking; verify ~1–3s round-trip. |

## Current architecture (as built)

The original plan described a self-built Python backend (ElevenLabs TTS, VTube
Studio avatar, Claude cloud API). That was **superseded** by the Project AIRI
pivot. What actually runs today:

```
Korean mic
  → AIRI (Electron desktop app: capture, VAD, turn-taking)
  → neru-audio gateway (127.0.0.1:3457, OpenAI-compatible)
      • STT  /v1/audio/transcriptions  — faster-whisper large-v3 (Korean)
  → LLM proxy (127.0.0.1:3456, OpenAI-compatible, pre-existing — not our code)
      • neru persona card → streams "English <ko>한국어</ko>" per sentence
  → AIRI response categoriser splits the stream:
      • English (outside <ko>) → neru-audio /v1/audio/speech (Chatterbox TTS) → speaker → Live2D lip-sync
      • Korean (inside <ko>)   → chat panel + caption overlay
```

| Concern | Original plan | As built |
|---------|---------------|----------|
| Frontend / avatar | self-built Vite + VTube Studio (pyvts) | **vendored Project AIRI** (Vue 3, built-in Live2D) |
| TTS | ElevenLabs (cloud) | **Chatterbox**, local on RTX 5080 |
| STT | faster-whisper (local) | faster-whisper large-v3 (kept), wrapped in `neru-audio` |
| LLM | Claude cloud API | pre-existing **local OpenAI-compatible proxy** at `:3456` |
| Voice/subtitle split | `{speech_en, subtitle_ko}` JSON fields | inline **`<ko>…</ko>`** markers parsed by the categoriser |
| Packaging | Python `neru/` app | single **Electron** app (`airi/apps/stage-tamagotchi`) + `neru-audio` service |

Deeper detail: [`.meridian/docs/pipeline-architecture.md`](.meridian/docs/pipeline-architecture.md)
and the README "Architecture" section.

## Where things live

- **This file** — the vision and phase status (durable).
- [`WORKSPACE.md`](WORKSPACE.md) — current state, known issues, immediate next steps.
- [`checklist.md`](checklist.md) — granular MVP task checkboxes (Korean working notes).
- [`context-notes.md`](context-notes.md) — decisions and rejected alternatives (Korean working notes).
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — per-feature design specs and implementation plans.
