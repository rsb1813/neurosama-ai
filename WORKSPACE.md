# Workspace

### neru — AI VTuber (Neuro-sama clone)
Single system = vendored Project AIRI fork (`airi/`). GPU voice tech in `airi/services/neru-audio/`.

**Repo:** public `rsb1813/neurosama-ai` on GitHub; `master` is branch-protected (PR required, no direct/force push, 0 required approvals). AIRI integration merged to master (PR #1). neru-audio gateway now requires an `Authorization: Bearer` token (`NERU_API_KEY`, default `sk-local-proxy`) + host restriction on `/v1/*` (security fix, PR #4).

**Autonomous dev pipeline (Claude, human-in-the-loop):**
- Claude Routines (claude.ai/code/routines): nightly **security audit** + **bug hunt** open GitHub issues labeled `security`/`bug`/`claude-fix`; **issue→fix** routine triggers on the `claude-fix` label (use the "issue labeled" trigger, NOT "opened") and opens a `claude/*` fix PR.
- GitHub Actions: `claude.yml` (@claude mentions), `claude-code-review.yml` (plugin review), `claude-fix-review.yml` (**review-only advisory** — posts a `VERDICT:` comment, no merge power; read+comment tools only, fork-excluded). A human always merges. Auth = Max OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`), no API key.
- ⚠️ Do NOT re-introduce auto-merge that lets one model both review untrusted PR content and merge/push (prompt-injection + token-exfil P0; removed in PR #9).

**Known Issues:**
- Packaged `airi.exe` has no Python — dev-only auto-spawn (`uv run`). Bundling approach undecided.
- neru-witch Live2D model removed with `frontend/` deletion — recoverable from `~/Downloads/neru-witch-live2d.zip`.
- 4 stage-tamagotchi vitest failures are pre-existing Windows symlink-permission (EPERM) errors in `plugins/index.test.ts` + `http-server/static-assets/paths.test.ts` — need Developer Mode/admin to pass locally.
- Integration DoD **exercised** (2026-07-10): real `pnpm desktop` run drives mic → STT → LLM(:3456) → TTS → avatar end-to-end. Fixed 3 live-loop bugs (PR #17): preseed was inert against stale AIRI localStorage (now authoritative), gateway 401'd CORS preflight (now allows OPTIONS for localhost origins), origin-allowlist duplication. Verified: STT 200, TTS 200, preflight 204.
- Bilingual output not yet wired: neru currently replies in Korean through the English-cloned voice (garbled). English-voice+Korean-subtitle is the active design (see Next Steps 1).

**Next Steps:**
1. **[active]** Bilingual output: neru card system-prompt emits English + `<ko>` Korean per sentence; extend AIRI response categoriser to route `<ko>` to the caption channel. Design in progress → spec under `docs/superpowers/specs/`.
2. neru witch Live2D model → AIRI model loader (model in `~/Downloads/neru-witch-live2d.zip`).
3. Rebrand productName airi→neru; packaged build with bundled runtime.
