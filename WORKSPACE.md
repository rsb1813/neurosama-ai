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
- **neru witch avatar (M-E Phase 2)** — emotion→exp3 wiring on `feat/neru-witch-emotion`. Wiring code + final review READY TO MERGE; `neruPreseed.ts` commits `expression-enabled=true` so exp3 register on boot.
- **Root cause fixed (verified from source): neru's persona had no ACT emotion-token protocol.** Expressions are driven by `<|ACT {"emotion":...}|>` tokens the LLM emits, but that protocol lived only in AIRI's **default** card description (`SystemPromptV2`); neru's active card = `NERU_SYSTEM_PROMPT` alone (airi-card.ts:428), so the LLM never emitted emotion tokens and `applyEmotion` never fired. **Done:** rewrote `NERU_SYSTEM_PROMPT` (`packages/stage-ui/src/constants/neru-persona.ts`) to embed the ACT protocol + shared emotion list (`EMOTION_PROMPT_LIST` in `emotions.ts`, now also consumed by `system-v2.ts`), kept the bilingual `<ko>` format, added a witch backstory + personality, and narrowed the STRICT output rule so it can't suppress ACT tokens (review p1). `<|ACT|>` (special marker) and `<ko>` (literal) don't collide. Commits `dfd890a` (persona) + `72d2afc` (review fixes); both reviewers ran, tests/typecheck/lint pass. App relaunched — **awaiting user visual confirmation** that emotions drive the witch's face.
- **Open runtime check:** neru replying English+`<ko>` confirms the neru card is active; face changing confirms ACT works end-to-end. If neru instead replies as AIRI/Neko in plain English, the active card is leaking to `default` (a separate preseed/hydration bug to chase). Verified from source that `airi-card-active-id` is asserted to `neru` unconditionally every boot (neruPreseed.ts:108), so this is not expected — but not yet observed at runtime.

**Known Issues:**
- Packaged `airi.exe` has no Python — dev-only auto-spawn (`uv run`). Bundling approach undecided.
- 4 stage-tamagotchi vitest failures are pre-existing Windows symlink-permission (EPERM) errors.
- **v1 bilingual persistence gap**: pure-English reply (zero `<ko>`, format violation) leaves `buildingMessage.slices` empty → persistence guard skips saving that assistant turn.
- **Caption overlay window shows nothing**: pre-existing AIRI infra issue (affects both caption-speaker and caption-assistant). Korean shows in chat panel.
- **Expression settings panel empty (cross-window, cosmetic)**: the panel shows "No expressions available" — ROOT CAUSE (verified via runtime instrumentation 2026-07-15): the expression store is renderer-local Pinia; the Live2D model registers its 12 exp3 in the **stage window's** store (proven: `registerExpressions groups=12`, all 12 exp3 fetch 200), but the settings panel runs in a **separate settings BrowserWindow** with its own empty store (no model there). No cross-window sync. The earlier suspects (`_expFiles`, load race, OPFS) were all refuted. Emotion→exp3 driving is NOT affected (it happens in the stage window). Panel fix = eventa IPC broadcast stage→settings, deferred. Full evidence in `.superpowers/sdd/progress.md`.

**Next Steps:**
1. Confirm on the running app that emotions drive the witch's face (see Open runtime check above), then push + PR + merge `feat/neru-witch-emotion`.
2. Barge-in: interrupt neru by speaking (M-G) — needs its own design (deferred; start with the human awake).
3. Optional future: fix the cross-window expression settings panel (cosmetic); extract shared `applyGroupValues` helper in expression-store (code-health P2 deferred).
