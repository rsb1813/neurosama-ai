# Workspace

### neru — AI VTuber (Neuro-sama clone)
Single system = vendored Project AIRI fork (`airi/`). GPU voice tech in `airi/services/neru-audio/`.

**Full roadmap → [`ROADMAP.md`](ROADMAP.md)** (9-subproject vision + MVP milestone status). This file tracks only the current-state / next-steps slice.

**Repo:** public `rsb1813/neurosama-ai` on GitHub; `master` is branch-protected (PR required, no direct/force push, 0 required approvals). AIRI integration merged to master (PR #1). neru-audio gateway requires `Authorization: Bearer` token (`NERU_API_KEY`, default `sk-local-proxy`) + host/origin restriction + CORS preflight for localhost origins on `/v1/*`.

**Autonomous dev pipeline (Claude, human-in-the-loop):**
- Claude Routines: nightly **security audit** + **bug hunt** → GitHub issues; **issue→fix** on `claude-fix` label (use "issue labeled" trigger, NOT "opened") → `claude/*` fix PR.
- GitHub Actions: `claude.yml` (@claude mentions), `claude-code-review.yml` (plugin review), `claude-fix-review.yml` (**review-only advisory** — `id-token: write` for OIDC, posts `VERDICT:` comment, no merge power). A human always merges.
- ⚠️ Do NOT re-introduce auto-merge that lets one model both review untrusted PR content and merge/push (prompt-injection + token-exfil P0; removed in PR #9).

**Ready for human merge:**
- **neru witch avatar (M-E Phase 2) — COMPLETE & runtime-validated** on `feat/neru-witch-emotion` (NOT pushed/PR'd — human merges). Emotions drive the witch's face end-to-end: LLM emits `<|ACT {"emotion":...}|>` → `Stage.vue` → `expressionStore.applyEmotion` → exp3 group activates, holds ~4s, relaxes. Confirmed live: happy=heart eyes (`x`), surprised/curious=star eyes (`xx`), etc.; the neru card is active (bilingual English+`<ko>` replies confirm it). Root cause that blocked it (neru's persona lacked the ACT protocol, which lived only in AIRI's default card via `SystemPromptV2`) is fixed: `NERU_SYSTEM_PROMPT` now embeds the ACT protocol + shared `EMOTION_PROMPT_LIST` (emotions.ts, also consumed by system-v2.ts), keeps `<ko>` format, adds a witch backstory + personality, narrows the STRICT rule so it can't suppress ACT tokens, and holds one emotion per short reply (no per-sentence flicker). Both reviewers ran; tests/typecheck/lint pass. Commits: `dfd890a`, `72d2afc`, `4c02709` (+ `4195b03` expression-enabled seed).
- Known cosmetic limit (accepted): 9 emotions → 7 facial exp3, so surprised & curious share the star-eye face and think & question share glasses. Intentional — only one star/glasses exp3 exists.

**Known Issues:**
- Packaged `airi.exe` has no Python — dev-only auto-spawn (`uv run`). Bundling approach undecided.
- 4 stage-tamagotchi vitest failures are pre-existing Windows symlink-permission (EPERM) errors.
- **v1 bilingual persistence gap**: pure-English reply (zero `<ko>`, format violation) leaves `buildingMessage.slices` empty → persistence guard skips saving that assistant turn.
- **Caption overlay window shows nothing**: pre-existing AIRI infra issue (affects both caption-speaker and caption-assistant). Korean shows in chat panel.
- **Expression settings panel empty (cross-window, cosmetic)**: the panel shows "No expressions available" — ROOT CAUSE (verified via runtime instrumentation 2026-07-15): the expression store is renderer-local Pinia; the Live2D model registers its 12 exp3 in the **stage window's** store (proven: `registerExpressions groups=12`, all 12 exp3 fetch 200), but the settings panel runs in a **separate settings BrowserWindow** with its own empty store (no model there). No cross-window sync. The earlier suspects (`_expFiles`, load race, OPFS) were all refuted. Emotion→exp3 driving is NOT affected (it happens in the stage window). Panel fix = eventa IPC broadcast stage→settings, deferred. Full evidence in `.superpowers/sdd/progress.md`.

**Next Steps:**
1. Human: push + PR + merge `feat/neru-witch-emotion` (M-E Phase 2 complete).
2. **Barge-in (M-G)** — interrupt neru by speaking: VAD detects user speech during TTS → stop playback + cancel the in-flight LLM stream + return to listening. Core MVP requirement, needs its own design (brainstorm → spec → plan). Likely the next milestone.
3. Known-issue cleanup candidates: caption overlay window shows nothing (pre-existing AIRI infra); v1 bilingual persistence gap (pure-English reply saves nothing); cross-window expression settings panel empty (cosmetic).
