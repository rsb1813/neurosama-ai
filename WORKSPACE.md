# Workspace

### neru — AI VTuber (Neuro-sama clone)
Single system = vendored Project AIRI fork (`airi/`). GPU voice tech in `airi/services/neru-audio/`.

**Repo:** public `rsb1813/neurosama-ai` on GitHub; `master` is branch-protected (PR required, no direct/force push, 0 required approvals). AIRI integration merged to master (PR #1). neru-audio gateway requires `Authorization: Bearer` token (`NERU_API_KEY`, default `sk-local-proxy`) + host/origin restriction + CORS preflight for localhost origins on `/v1/*`.

**Autonomous dev pipeline (Claude, human-in-the-loop):**
- Claude Routines: nightly **security audit** + **bug hunt** → GitHub issues; **issue→fix** on `claude-fix` label (use "issue labeled" trigger, NOT "opened") → `claude/*` fix PR.
- GitHub Actions: `claude.yml` (@claude mentions), `claude-code-review.yml` (plugin review), `claude-fix-review.yml` (**review-only advisory** — `id-token: write` for OIDC, posts `VERDICT:` comment, no merge power). A human always merges.
- ⚠️ Do NOT re-introduce auto-merge that lets one model both review untrusted PR content and merge/push (prompt-injection + token-exfil P0; removed in PR #9).

**In Progress:**
- **Bilingual output** (`feat/neru-bilingual` branch, SDD): neru card system-prompt emits English + `<ko>한국어</ko>` per sentence; AIRI response categoriser routes `<ko>` to display/subtitle, English to TTS only. **Tasks 1-6 done**; Task 7 (E2E) in progress. E2E verified: English voice ✓, Korean chat panel ✓, gateway STT/TTS 200 ✓.
- **E2E-found bug, FIXED** (commits 5f11741 + d898ad1): the streaming `categorizer.filterToSpeech` dropped the English preceding an opening `<ko>` when a stream chunk straddled the tag boundary → first 1-2 spoken sentences silently swallowed + tag fragments leaked to TTS. Replaced with `<ko>`-segment-boundary slicing (emit English before each completed segment; skip reasoning-tag content; flush trailing English in onEnd, cut at first `<`). code-reviewed (opus), 74/74 tests pass. Pending final E2E confirmation.

**Known Issues:**
- Packaged `airi.exe` has no Python — dev-only auto-spawn (`uv run`). Bundling approach undecided.
- neru-witch Live2D model removed with `frontend/` deletion — recoverable from `~/Downloads/neru-witch-live2d.zip`.
- 4 stage-tamagotchi vitest failures are pre-existing Windows symlink-permission (EPERM) errors.
- **v1 bilingual persistence gap**: pure-English reply (zero `<ko>`, format violation) leaves `buildingMessage.slices` empty → persistence guard skips saving that assistant turn. Relying on strict prompt; fix with English-fallback + tight audio-sync follow-up.
- v1 caption sync is generation-timed (caption may lead voice on long replies). Tight audio-synced captions deferred.
- **Caption overlay window shows nothing (OPEN)**: main window's `postCaption` fires correctly (verified via debug log — `caption-assistant` posted per `<ko>`), but the separate caption overlay window renders no text. Chat panel Korean works; overlay does not. Same-origin in dev (both `http://localhost:5173`), so BroadcastChannel *should* cross. Caption window console isn't piped to the app stdout, blocking observation. Affects both `caption-speaker` and `caption-assistant` → shared caption.vue/BroadcastChannel infra issue, likely pre-existing (not from bilingual work). Next debugging target.

**Next Steps:**
1. Manual E2E of bilingual output (SDD Task 7): `pnpm desktop`, speak Korean → verify English voice + Korean screen + gateway 200s. Then final whole-branch review + finish branch.
2. neru witch Live2D model → AIRI model loader.
3. Rebrand productName airi→neru; packaged build with bundled runtime.
