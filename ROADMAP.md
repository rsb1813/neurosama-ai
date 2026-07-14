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
| 2 | Long-term memory | ⬜ Planned | Vector DB / RAG (pgvector or DuckDB). |
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
| **M-E — neru "witch" Live2D model in AIRI** | ⬜ **Not started** — currently uses AIRI's default avatar (Hiyori). Model file was lost with the old `frontend/`; recover from `~/Downloads/neru-witch-live2d.zip`. |
| **M-F — Bilingual output (English voice + Korean subtitles)** ★core | 🔄 **In progress** — persona card + `<ko>` categoriser + routing done; TTS first-sentence-drop bug fixed; caption-overlay display still under debug (chat-panel Korean works). |
| **M-G — Full loop + barge-in** | ⬜ **Not started** — interrupt neru by speaking; verify ~1–3s round-trip. |

## Where things live

- **This file** — the vision and phase status (durable).
- [`WORKSPACE.md`](WORKSPACE.md) — current state, known issues, immediate next steps.
- [`checklist.md`](checklist.md) — granular MVP task checkboxes (Korean working notes).
- [`context-notes.md`](context-notes.md) — decisions and rejected alternatives (Korean working notes).
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — per-feature design specs and implementation plans.
