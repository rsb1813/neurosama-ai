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
- **Barge-in (M-G)** on `feat/neru-barge-in` — all 4 SDD tasks + final-review fix, all reviewed clean (ledger: `.superpowers/sdd/progress.md`). Tests green (core-agent 16/16, stage-ui use-barge-in 5/5; typecheck 0). Awaiting human push/PR/merge + manual mic verification.
  - Task 1: in-flight LLM abort (`abortActiveStream` on runtime + chat store) `be9d457`
  - Task 2: persist partial reply on abort (graceful handling in `performSend` catch) `db648be`
  - Task 3: `useBargeIn` composable (VAD speech-start gating) `c999068` + test fix `5ffcbad`
  - Task 4: Stage.vue wiring + `'barge-in'` stop reason `cd4cb07`
  - Final-review fix: discriminate barge-in by `AbortError` identity, not the sticky `signal.aborted` flag (fixes tail-barge-in double-append + error-swallow) `b1ae418`; lint cleanup `c1b6616`
  - Spec: `docs/superpowers/specs/2026-07-15-neru-barge-in-design.md`; Plan: `docs/superpowers/plans/2026-07-15-neru-barge-in.md`
  - Merge-time notes (non-blocking): barge-in doesn't `cancelPendingSends` (benign, no self-queue); brief `nowSpeaking||sending` blind window on ultra-short replies; D3 — partial persists only after ≥1 `<ko>` closes.

**Key Decisions:**
- Audio setup = headphones → no AEC needed for barge-in MVP.
- D3: partial reply kept in history on barge-in. Nuance: only closed `<ko>` segments persist; barge-in before first `<ko>` closes saves nothing (same as normal finalize; ties to bilingual-persistence gap).

**Known Issues:**
- Packaged `airi.exe` has no Python — dev-only auto-spawn (`uv run`). Bundling approach undecided.
- 4 stage-tamagotchi vitest failures are pre-existing Windows symlink-permission (EPERM) errors.
- **v1 bilingual persistence gap**: pure-English reply (zero `<ko>`, format violation) leaves `buildingMessage.slices` empty → persistence guard skips saving that assistant turn.
- **Caption overlay window shows nothing**: pre-existing AIRI infra issue. Korean shows in chat panel.
- **Expression settings panel empty (cross-window, cosmetic)**: renderer-local Pinia; exp3 registered in stage window, settings panel has its own empty store. Fix = eventa IPC broadcast, deferred.

**Next Steps:**
1. Final whole-branch review of `feat/neru-barge-in` (SDD tasks 1-4), then human push + PR + merge.
2. Manual verification with headphones: speak while neru talks → audio stops ~300ms; speak while thinking → generation cancels; speak while idle → normal turn.
3. After barge-in lands: bilingual persistence gap fix, caption overlay, or next milestone.
