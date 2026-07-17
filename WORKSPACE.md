# Workspace

### neru — AI VTuber (Neuro-sama clone)
Single system = vendored Project AIRI fork (`airi/`). GPU voice tech in `airi/services/neru-audio/`.

**Full roadmap → [`ROADMAP.md`](ROADMAP.md)** (9-subproject vision + MVP milestone status). This file tracks only the current-state / next-steps slice.

**Repo:** public `rsb1813/neurosama-ai` on GitHub; `master` is branch-protected (PR required, no direct/force push, 0 required approvals). AIRI integration merged to master (PR #1). neru-audio gateway requires `Authorization: Bearer` token (`NERU_API_KEY`, default `sk-local-proxy`) + host/origin restriction + CORS preflight for localhost origins on `/v1/*`.

**Autonomous dev pipeline (Claude, human-in-the-loop):**
- Claude Routines: nightly **security audit** + **bug hunt** → GitHub issues; **issue→fix** on `claude-fix` label (use "issue labeled" trigger, NOT "opened") → `claude/*` fix PR.
- GitHub Actions: `claude.yml` (@claude mentions), `claude-code-review.yml` (plugin review), `claude-fix-review.yml` (**review-only advisory** — `id-token: write` for OIDC, posts `VERDICT:` comment, no merge power). A human always merges.
- ⚠️ Do NOT re-introduce auto-merge that lets one model both review untrusted PR content and merge/push (prompt-injection + token-exfil P0; removed in PR #9).

**Recently merged to `master`:**
- **Barge-in (M-G) — MERGED** via PR #21 (`feat/neru-barge-in` → `master`, merge `b097535`). Interrupt neru by speaking: in-flight LLM abort + partial-reply persistence + `useBargeIn` VAD gating + Stage.vue wiring + `'barge-in'` stop reason. Final-review fix discriminates barge-in by `AbortError` identity, not the sticky `signal.aborted` flag. Reviewed clean; tests green (core-agent 16/16, stage-ui use-barge-in 5/5). **Still pending: human manual mic verification** (headphones — see Next Steps).
  - Spec: `docs/superpowers/specs/2026-07-15-neru-barge-in-design.md`; Plan: `docs/superpowers/plans/2026-07-15-neru-barge-in.md`
  - Merge-time notes (non-blocking): barge-in doesn't `cancelPendingSends` (benign, no self-queue); brief `nowSpeaking||sending` blind window on ultra-short replies; D3 — partial persists only after ≥1 `<ko>` closes.

**In Progress:**
- **Long-term memory (#2)** — PR #22 open (`feat/neru-long-term-memory` → `master`; merged up to current master incl. barge-in). Code complete; tests pass (stage-ui memory 14/14, tamagotchi tool 4/4), typecheck clean, 2 code reviews (no Critical/Important). Awaiting human runtime verification + merge. Key check: tell neru a fact → restart → confirm she recalls it.

**Key Decisions:**
- Audio setup = headphones → no AEC needed for barge-in MVP.
- D3: partial reply kept in history on barge-in. Nuance: only closed `<ko>` segments persist; barge-in before first `<ko>` closes saves nothing (same as normal finalize; ties to bilingual-persistence gap).

**Known Issues:**
- Packaged `airi.exe` has no Python — dev-only auto-spawn (`uv run`). Bundling approach undecided.
- 4 stage-tamagotchi vitest failures are pre-existing Windows symlink-permission (EPERM) errors.
- **v1 bilingual persistence gap**: pure-English reply (zero `<ko>`, format violation) leaves `buildingMessage.slices` empty → persistence guard skips saving that assistant turn.
- **Caption overlay window shows nothing**: pre-existing AIRI infra issue (affects both caption-speaker and caption-assistant). Korean shows in chat panel.
- **Expression settings panel empty (cross-window, cosmetic)**: panel runs in separate BrowserWindow with its own empty Pinia store (no model registered there). Emotion→exp3 driving is NOT affected (happens in stage window). Fix = eventa IPC broadcast stage→settings, deferred.
- STT/voice input on hold — mic capture quality too low (silence hallucination). Using text input. Code retained, dormant.
- **Memory lost-update is guarded only for a single writer window**: the `remember` tool serializes read-modify-write on a renderer module-level promise chain, and the main-process write is serialized too — but that prevents *file corruption*, not *cross-window lost-update*. Fine for today's single chat window; if a second window ever writes MEMORY.md, move the append into the main process (atomic read-append-write) or the last writer will silently clobber the other's bullet.

**Next Steps:**
1. Human: manual mic verification of barge-in (now merged, headphones): speak while neru talks → audio stops ~300ms; speak while thinking → generation cancels; speak while idle → normal turn.
2. Human: runtime-verify long-term memory (PR #22) — tell neru a fact → restart → recall — then merge.
3. After both land: bilingual persistence gap fix, caption overlay, cross-window expression panel, or next subproject (#3 proactive speech / #4 chat integration).
