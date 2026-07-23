# Workspace

### neru — AI VTuber (Neuro-sama clone)
Single system = vendored Project AIRI fork (`airi/`). GPU voice tech in `airi/services/neru-audio/`.

**Full roadmap → [`ROADMAP.md`](ROADMAP.md)** (9-subproject vision + MVP milestone status). This file tracks only the current-state / next-steps slice.

**Repo:** public `rsb1813/neurosama-ai` on GitHub; `master` is branch-protected (PR required, no direct/force push, 0 required approvals). AIRI integration merged to master (PR #1). neru-audio gateway requires `Authorization: Bearer` token (`NERU_API_KEY`, default `sk-local-proxy`) + host/origin restriction + CORS preflight for localhost origins on `/v1/*`.

**Autonomous development and review pipeline (human-in-the-loop):**
- Claude Routines: nightly **security audit** + **bug hunt** → GitHub issues; **issue→fix** on `claude-fix` label (use "issue labeled" trigger, NOT "opened") → `claude/*` fix PR.
- Codex GitHub integration provides automatic PR review outside repository workflow files. Claude GitHub Actions were removed in PR #30. A human always merges.
- ⚠️ Do NOT re-introduce auto-merge that lets one model both review untrusted PR content and merge/push (prompt-injection + token-exfil P0; removed in PR #9).

**Recently merged to `master`:**
- **Barge-in (M-G) — MERGED** via PR #21 (`feat/neru-barge-in` → `master`, merge `b097535`). Interrupt neru by speaking: in-flight LLM abort + partial-reply persistence + `useBargeIn` VAD gating + Stage.vue wiring + `'barge-in'` stop reason. Final-review fix discriminates barge-in by `AbortError` identity, not the sticky `signal.aborted` flag. Reviewed clean; tests green (core-agent 16/16, stage-ui use-barge-in 5/5). **Still pending: human manual mic verification** (headphones — see Next Steps).
  - Spec: `docs/superpowers/specs/2026-07-15-neru-barge-in-design.md`; Plan: `docs/superpowers/plans/2026-07-15-neru-barge-in.md`
  - Merge-time notes (non-blocking): barge-in doesn't `cancelPendingSends` (benign, no self-queue); brief `nowSpeaking||sending` blind window on ultra-short replies; D3 — partial persists only after ≥1 `<ko>` closes.
- **Long-term memory (#2) — MERGED** via PR #22 (`afe46d5`), **runtime-validated**. A `remember` LLM tool saves categorized facts to `<userData>/neru-memory/MEMORY.md`; startup loads them; a runtime context provider injects a budget-capped recall block each turn. Confirmed live: neru saved a fact and recalled it across an app restart. Reviewed clean (no Critical/Important); final review caught & fixed 2 data-loss bugs (concurrent-remember lost-update, ENOENT-only `ensureFile`). Spec/plan under `docs/superpowers/`.
- **STT gated off for VRAM — MERGED** via PR #23. neru-audio's whisper `large-v3` was lazy-loading via the still-active mic path and eating ~3GB VRAM though voice is on hold; now gated behind `NERU_STT_ENABLED` (default off), `/v1/audio/transcriptions` → 503 when disabled. Re-enable with `NERU_STT_ENABLED=true`.
- **TTS "garbled voice" fix — MERGED** via PR #24. In long Korean chats neru drifted into pure Korean, or *inverted* the format (`Korean <ko>English</ko>`), sending Korean to the English-only Chatterbox TTS → garbled audio. Root cause = persona format drift, NOT a code bug (the `<ko>` categorizer correctly excludes `<ko>` from speech — verified offline). Fixed by strengthening `NERU_SYSTEM_PROMPT` (emphatic always-English + HARD RULE + a CRITICAL contrastive WRONG/RIGHT example) + a regression test. Verified live via TTS-input logging: English now reaches the TTS. Diagnosis tip: a temp `print()` of the TTS input text in neru-audio `app.py` shows exactly what is synthesized.

- **Web search — MERGED** via PR #26. A self-hosted SearXNG JSON API is accessed through a main-process IPC service, avoiding renderer-to-localhost CORS; the builtin `webSearch` LLM tool is always on and degrades gracefully when search is unavailable. Manual runtime verification succeeded.

**Local work awaiting integration:**
- **Direct Codex OAuth** on `codex/direct-codex-oauth`. Neru now performs Device OAuth and Codex Responses streaming directly from Electron main, stores the credential with Windows user-scope encryption, carries the full AIRI conversation and function tools, and no longer requires the Codex CLI or app-server. The model refresh button now fetches the account-specific remote Codex catalog once and uses the selected remote model for the live stream; opening settings no longer fetches automatically. Automated focused tests are complete; Terra visibility and a live response in the restarted app remain to be verified before integration.
- **Proactive speech (#3)** on `feat/neru-proactive-speech` at `3e3b8c4`. Implementation and automated verification are complete: 26 tests and three package typechecks passed in the Claude session. Remaining gate: restart the app, wait 45 seconds idle, verify spontaneous speech, verify no more than two unanswered nudges, then send a user message and verify it resets the counter. After that, push and open a PR.

**Key Decisions:**
- Audio setup = headphones → no AEC needed for barge-in MVP.
- D3: partial reply kept in history on barge-in. Nuance: only closed `<ko>` segments persist; barge-in before first `<ko>` closes saves nothing (same as normal finalize; ties to bilingual-persistence gap).
- **neru's spoken voice is English-only** (Chatterbox clone); Korean lives ONLY inside `<ko>` (on-screen subtitle). Persona hard-enforces this (PR #24) — any Korean in the spoken position garbles the voice, so the format direction (`English <ko>Korean</ko>`) must never invert.

**Known Issues:**
- Packaged `airi.exe` has no Python — dev-only auto-spawn (`uv run`). Bundling approach undecided.
- 4 stage-tamagotchi vitest failures are pre-existing Windows symlink-permission (EPERM) errors.
- **v1 bilingual persistence gap**: pure-English reply (zero `<ko>`, format violation) leaves `buildingMessage.slices` empty → persistence guard skips saving that assistant turn.
- **Caption overlay window shows nothing**: pre-existing AIRI infra issue (affects both caption-speaker and caption-assistant). Korean shows in chat panel.
- **Expression settings panel empty (cross-window, cosmetic)**: panel runs in separate BrowserWindow with its own empty Pinia store (no model registered there). Emotion→exp3 driving is NOT affected (happens in stage window). Fix = eventa IPC broadcast stage→settings, deferred.
- STT/voice input on hold — mic capture quality too low (silence hallucination). Using text input. Code retained but now gated OFF by default (`NERU_STT_ENABLED`, PR #23) so whisper never loads / doesn't eat VRAM; re-enable when voice work resumes.
- **Memory lost-update is guarded only for a single writer window**: the `remember` tool serializes read-modify-write on a renderer module-level promise chain, and the main-process write is serialized too — but that prevents *file corruption*, not *cross-window lost-update*. Fine for today's single chat window; if a second window ever writes MEMORY.md, move the append into the main process (atomic read-append-write) or the last writer will silently clobber the other's bullet.

**Next Steps:**
1. Run `codex/direct-codex-oauth`, complete a fresh Device OAuth login, and verify one normal response plus one `remember` tool call before integration.
2. Validate proactive speech at runtime, then push `feat/neru-proactive-speech` and open its PR: after an app restart, wait 45 seconds idle for spontaneous speech, confirm at most two unanswered nudges, and confirm a user message resets the counter.
3. Human: manual mic verification of barge-in (headphones): speak while neru talks → audio stops ~300ms; speak while thinking → generation cancels; speak while idle → normal turn.
4. Later: bilingual persistence gap fix, caption overlay, cross-window expression panel, or #4 chat integration.
