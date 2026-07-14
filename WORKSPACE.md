# Workspace

### neru — AI VTuber (Neuro-sama clone)
Single system = vendored Project AIRI fork (`airi/`). GPU voice tech in `airi/services/neru-audio/`.

**Full roadmap → [`ROADMAP.md`](ROADMAP.md)** (9-subproject vision + MVP milestone status). This file tracks only the current-state / next-steps slice.

**Repo:** public `rsb1813/neurosama-ai` on GitHub; `master` is branch-protected (PR required, no direct/force push, 0 required approvals). AIRI integration merged to master (PR #1). neru-audio gateway requires `Authorization: Bearer` token (`NERU_API_KEY`, default `sk-local-proxy`) + host/origin restriction + CORS preflight for localhost origins on `/v1/*`.

**Autonomous dev pipeline (Claude, human-in-the-loop):**
- Claude Routines: nightly **security audit** + **bug hunt** → GitHub issues; **issue→fix** on `claude-fix` label (use "issue labeled" trigger, NOT "opened") → `claude/*` fix PR.
- GitHub Actions: `claude.yml` (@claude mentions), `claude-code-review.yml` (plugin review), `claude-fix-review.yml` (**review-only advisory** — `id-token: write` for OIDC, posts `VERDICT:` comment, no merge power). A human always merges.
- ⚠️ Do NOT re-introduce auto-merge that lets one model both review untrusted PR content and merge/push (prompt-injection + token-exfil P0; removed in PR #9).

**In Progress:**
- **neru witch avatar (M-E Phase 1)** — PR #19 open, pending merge. Witch renders as default with blink/lip-sync. 12 expressions don't register in AIRI's expression store (Phase 2 scope). On `feat/neru-witch-avatar`.

**Known Issues:**
- Packaged `airi.exe` has no Python — dev-only auto-spawn (`uv run`). Bundling approach undecided.
- 4 stage-tamagotchi vitest failures are pre-existing Windows symlink-permission (EPERM) errors.
- **v1 bilingual persistence gap**: pure-English reply (zero `<ko>`, format violation) leaves `buildingMessage.slices` empty → persistence guard skips saving that assistant turn.
- **Caption overlay window shows nothing**: pre-existing AIRI infra issue (affects both caption-speaker and caption-assistant). Korean shows in chat panel.
- **Expression registration (Phase 2)**: witch's 12 exp3 expressions don't register in AIRI's expression store — `initExpressionController` silently early-returns. Suspects: `settings.expressions` vs zip-loader's `_expFiles` mismatch; expression-enabled load-time race; OPFS cache. Diagnosed in `.superpowers/sdd/progress.md`.

**Next Steps:**
1. Merge PR #19 (witch avatar Phase 1). Then Phase 2: fix expression registration + visual catalog + emotion→exp3 glue.
2. Barge-in: interrupt neru by speaking (M-G).
