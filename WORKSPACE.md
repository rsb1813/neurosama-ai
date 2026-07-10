# Workspace

### neru — AI VTuber (Neuro-sama clone)
Single system = vendored Project AIRI fork (`airi/`). GPU voice tech in `airi/services/neru-audio/`.

**Repo:** public `rsb1813/neurosama-ai` on GitHub; `master` is branch-protected (PR required, no direct/force push, 0 required approvals). AIRI integration merged to master (PR #1). neru-audio gateway requires `Authorization: Bearer` token (`NERU_API_KEY`, default `sk-local-proxy`) + host/origin restriction + CORS preflight for localhost origins on `/v1/*`.

**Autonomous dev pipeline (Claude, human-in-the-loop):**
- Claude Routines: nightly **security audit** + **bug hunt** → GitHub issues; **issue→fix** on `claude-fix` label (use "issue labeled" trigger, NOT "opened") → `claude/*` fix PR.
- GitHub Actions: `claude.yml` (@claude mentions), `claude-code-review.yml` (plugin review), `claude-fix-review.yml` (**review-only advisory** — `id-token: write` for OIDC, posts `VERDICT:` comment, no merge power). A human always merges.
- ⚠️ Do NOT re-introduce auto-merge that lets one model both review untrusted PR content and merge/push (prompt-injection + token-exfil P0; removed in PR #9).

**In Progress:**
- **Bilingual output** (`feat/neru-bilingual` branch, SDD): neru card system-prompt emits English + `<ko>한국어</ko>` per sentence; AIRI response categoriser routes `<ko>` to display/subtitle, English to TTS only. **Tasks 1-6 of 7 complete, all reviewed clean** (persona constant, card preseed, categoriser, onSubtitle hook, core routing, Stage.vue caption swap → overlay now Korean-only). Only Task 7 (manual E2E) remains; core-agent dist rebuilt for it.

**Known Issues:**
- Packaged `airi.exe` has no Python — dev-only auto-spawn (`uv run`). Bundling approach undecided.
- neru-witch Live2D model removed with `frontend/` deletion — recoverable from `~/Downloads/neru-witch-live2d.zip`.
- 4 stage-tamagotchi vitest failures are pre-existing Windows symlink-permission (EPERM) errors.
- **v1 bilingual persistence gap**: pure-English reply (zero `<ko>`, format violation) leaves `buildingMessage.slices` empty → persistence guard skips saving that assistant turn. Relying on strict prompt; fix with English-fallback + tight audio-sync follow-up.
- v1 caption sync is generation-timed (caption may lead voice on long replies). Tight audio-synced captions deferred.

**Next Steps:**
1. Manual E2E of bilingual output (SDD Task 7): `pnpm desktop`, speak Korean → verify English voice + Korean screen + gateway 200s. Then final whole-branch review + finish branch.
2. neru witch Live2D model → AIRI model loader.
3. Rebrand productName airi→neru; packaged build with bundled runtime.
