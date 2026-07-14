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
- **Bilingual output** (`feat/neru-bilingual` branch, SDD): neru card system-prompt emits English + `<ko>한국어</ko>` per sentence; AIRI response categoriser routes `<ko>` to display/subtitle, English to TTS only. **Tasks 1-6 done**; E2E verified: English voice ✓ (first-sentence bug fixed, log-confirmed all sentences from first), Korean chat panel ✓, gateway STT/TTS 200 ✓. Only caption overlay remains broken (see Known Issues).
- **Caption overlay (deferred to a separate track)**: the separate caption overlay Electron window renders nothing, but this affects both `caption-speaker` and `caption-assistant` → it is a **pre-existing AIRI caption/BroadcastChannel infra issue, not introduced by the bilingual work**. Bilingual routing does its job (`postCaption` fires per `<ko>`, log-verified); Korean shows in the chat panel. Overlay rendering split out under Known Issues, not a bilingual blocker.

**Known Issues:**
- Packaged `airi.exe` has no Python — dev-only auto-spawn (`uv run`). Bundling approach undecided.
- neru-witch Live2D model removed with `frontend/` deletion — recoverable from `~/Downloads/neru-witch-live2d.zip`.
- 4 stage-tamagotchi vitest failures are pre-existing Windows symlink-permission (EPERM) errors.
- **v1 bilingual persistence gap**: pure-English reply (zero `<ko>`, format violation) leaves `buildingMessage.slices` empty → persistence guard skips saving that assistant turn. Relying on strict prompt; fix with English-fallback + tight audio-sync follow-up.
- v1 caption sync is generation-timed (caption may lead voice on long replies). Tight audio-synced captions deferred.
- **Caption overlay window shows nothing (OPEN)**: main window's `postCaption` fires correctly (verified via debug log — `caption-assistant` posted per `<ko>`), but the separate caption overlay window renders no text. Chat panel Korean works; overlay does not. Same-origin in dev (both `http://localhost:5173`), so BroadcastChannel *should* cross. Caption window console isn't piped to the app stdout, blocking observation. Affects both `caption-speaker` and `caption-assistant` → shared caption.vue/BroadcastChannel infra issue, likely pre-existing (not from bilingual work). Next debugging target.

**Next Steps:**
1. Bilingual core (M-F) is functionally done (English voice + Korean chat panel, verified). Caption overlay rendering is a pre-existing AIRI infra issue, split to a separate track — not a bilingual blocker. Proceed to final whole-branch review + finish branch.
2. neru witch Live2D model → AIRI model loader (M-E).
3. Barge-in: interrupt neru by speaking (M-G).
