# Workspace

### neru — AI VTuber (Neuro-sama clone)
Single system = vendored Project AIRI fork (`airi/`). GPU voice tech in `airi/services/neru-audio/`.

**In Progress:** `neru-airi-integration` branch — 8 commits (Tasks 1–5 + final-review fix). Final whole-branch review cleared: 1 Critical fixed (preseed VueUse serializer, commit 0f53d33), Minors triaged. Merge-ready; PR pending.

**Known Issues:**
- Packaged `airi.exe` has no Python — dev-only auto-spawn (`uv run`). Bundling approach undecided.
- neru-witch Live2D model removed with `frontend/` deletion — recoverable from `~/Downloads/neru-witch-live2d.zip`.
- README.md stale (still describes old layout).
- 4 stage-tamagotchi vitest failures are pre-existing Windows symlink-permission (EPERM) errors in `plugins/index.test.ts` + `http-server/static-assets/paths.test.ts` — untouched by this branch, need Developer Mode/admin to pass locally.
- Integration DoD (real `pnpm desktop` launch: Korean input → Claude reply + gateway auto-spawn) still to be exercised once by the user (GUI + mic + GPU).

**Next Steps:**
1. Merge/PR `neru-airi-integration` (review cleared).
2. neru persona → AIRI character card (preserved in `docs/superpowers/specs/neru-persona-reference.md`).
3. English voice + Korean subtitle wiring (AIRI core modification).
4. neru witch Live2D model → AIRI model loader.
5. Rebrand productName airi→neru.
