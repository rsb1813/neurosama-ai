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
- **neru witch avatar (M-E Phase 2)** — emotion→exp3 wiring on `feat/neru-witch-emotion`. Wiring code + final review READY TO MERGE; `neruPreseed.ts` now commits `expression-enabled=true` so exp3 register on boot.
- **BLOCKER found (verified from source): neru's persona has no ACT emotion-token protocol.** Expressions are driven by `<|ACT {"emotion":...}|>` tokens the LLM emits, but that protocol lives only in AIRI's **default** card description (`SystemPromptV2`). neru's active card = `NERU_SYSTEM_PROMPT` alone (airi-card.ts:428 assembles active-card fields), which has the bilingual `<ko>` format but no ACT scaffolding → the LLM never emits emotion tokens → `applyEmotion` never fires → face never changes. Fix in progress: rewrite `NERU_SYSTEM_PROMPT` (`packages/stage-ui/src/constants/neru-persona.ts`) to include the ACT protocol + auto-generated emotion list (DRY via `EMOTION_VALUES`), keep `<ko>` format, drop the Neko/AIRI character text, and enrich personality/tone (user approved full persona). `<|ACT|>` (special marker) and `<ko>` (literal) don't collide — different delimiters. Runtime check after apply: neru replying English+`<ko>` confirms neru card active; face changing confirms ACT works. If neru replies as AIRI/Neko, active card is leaking to `default` (separate bug).

**Known Issues:**
- Packaged `airi.exe` has no Python — dev-only auto-spawn (`uv run`). Bundling approach undecided.
- 4 stage-tamagotchi vitest failures are pre-existing Windows symlink-permission (EPERM) errors.
- **v1 bilingual persistence gap**: pure-English reply (zero `<ko>`, format violation) leaves `buildingMessage.slices` empty → persistence guard skips saving that assistant turn.
- **Caption overlay window shows nothing**: pre-existing AIRI infra issue (affects both caption-speaker and caption-assistant). Korean shows in chat panel.
- **Expression settings panel empty (cross-window, cosmetic)**: the panel shows "No expressions available" — ROOT CAUSE (verified via runtime instrumentation 2026-07-15): the expression store is renderer-local Pinia; the Live2D model registers its 12 exp3 in the **stage window's** store (proven: `registerExpressions groups=12`, all 12 exp3 fetch 200), but the settings panel runs in a **separate settings BrowserWindow** with its own empty store (no model there). No cross-window sync. The earlier suspects (`_expFiles`, load race, OPFS) were all refuted. Emotion→exp3 driving is NOT affected (it happens in the stage window). Panel fix = eventa IPC broadcast stage→settings, deferred. Full evidence in `.superpowers/sdd/progress.md`.

**Next Steps:**
1. Land the neru persona ACT-protocol rewrite (see BLOCKER above), relaunch, confirm emotions drive the witch's face, then push + PR + merge `feat/neru-witch-emotion`.
2. Barge-in: interrupt neru by speaking (M-G) — needs its own design (deferred; start with the human awake).
3. Optional future: fix the cross-window expression settings panel (cosmetic); extract shared `applyGroupValues` helper in expression-store (code-health P2 deferred).
