<!-- M-E Phase 1 설계 스펙 — neru 마녀 Live2D 모델을 AIRI 기본 아바타로 렌더 + 자동동작. Phase 2(감정→표정)는 별도 스펙. -->
# neru Witch Avatar — Render + Auto-Behaviors (M-E Phase 1) Design

**Status:** Approved design, ready for implementation planning.
**Milestone:** M-E (neru "witch" Live2D model in AIRI), **Phase 1 of 2**.
**Branch:** `feat/neru-witch-avatar`.

## Goal

Make the neru **witch** Live2D model AIRI's default avatar (replacing the
built-in Hiyori), rendering with working **auto eye-blink, eye-gaze, and audio
lip-sync**. Produce a **catalog of the model's 12 expressions** as the input to
Phase 2.

## Why phased

The user wants emotion→expression wiring, but AIRI has **no emotion→Live2D-exp3
mapping today** (emotions map only to *motion groups*; the exp3 expression
system is driven only by LLM `expression_*` tools + manual UI — see Research
§Emotion below). The witch model has no emotion-named motions (only one `idle`
motion), so its 12 `.exp3.json` expressions are the only emotional surface, and
**those expressions are opaque** (pinyin names `cw/fz/h/hdj/ku/mz/sq/x/xx/yj/
zs1/zs2`, each toggling a custom `Param59`–`Param72`). We cannot map 9 emotions
to 12 unknown expressions without first seeing them rendered. Therefore:

- **Phase 1 (this spec):** render the model + auto-behaviors; catalog the 12
  expressions by applying each via the existing manual UI.
- **Phase 2 (separate spec):** build the emotion→exp3 glue using Phase 1's catalog.

## The asset

`~/Downloads/neru-witch-live2d.zip` (38.4 MB). Standard Cubism 4 (`Version 3`,
`.moc3`). Contents (top-level, Japanese filenames):

- `魔女.model3.json` (definition), `魔女.moc3` (10.9 MB)
- `魔女.8192/texture_00.png` (27 MB), `texture_01.png` (6.3 MB) — 8192px textures
- `魔女.physics3.json`, `魔女.cdi3.json`
- `Scene1.motion3.json` (one `idle` motion)
- 12 expressions: `cw, fz, h, hdj, ku, mz, sq, x, xx, yj, zs1, zs2` (`.exp3.json`)

`model3.json` `Groups` already declare the standard parameter groups that AIRI's
auto-behaviors drive:

- `EyeBlink`: `ParamEyeLOpen`, `ParamEyeROpen`
- `LipSync`: `ParamMouthOpenY`

Gaze uses `ParamEyeBallX/Y` (not in Groups, but a standard rig ID — verify at
implementation; if absent, gaze silently no-ops, non-fatal).

## Research anchors (AIRI, verified by code reading)

How AIRI loads and drives a Live2D model — the plan builds on these:

- **Default model** = Hiyori Pro, bundled zip
  `packages/stage-ui/src/assets/live2d/models/hiyori_pro_zh.zip` (31.6 MB),
  registered as a preset in `packages/stage-ui/src/stores/display-models.ts:50`
  (`presetLive2dProUrl` via `new URL('../assets/live2d/models/hiyori_pro_zh.zip',
  import.meta.url)`), selected by default via
  `packages/stage-ui/src/stores/settings/stage-model.ts:18`
  (`'settings/stage/model'` = `'preset-live2d-1'`).
- **Loader** — `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue`
  → `Live2DFactory.setupLive2DModel(model, { url, id }, { autoInteract: false })`
  (~line 253). Zip decoding via `packages/stage-ui-live2d/src/utils/live2d-zip-loader.ts`
  (JSZip, finds `.model3.json`, resolves refs **inside the archive**). Unzipped
  models are cached in **OPFS** (`utils/opfs-loader.ts`).
- **Selection stores** — `useDisplayModelsStore` (catalog: presets + IndexedDB
  imports) and `useSettingsStageModel` (`updateStageModel()` resolves the URL).
- **Custom-model import already exists** — `model-selector.vue` (`.zip` → IndexedDB),
  so the loader path is proven for arbitrary Cubism 4 zips.
- **Auto-behaviors are AIRI-driven** (per-frame Cubism param writes, not motion
  files) in `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts`:
  blink (`ParamEyeLOpen/ROpen`), lip-sync (`ParamMouthOpenY` from `mouthOpenSize`,
  computed in `Stage.vue` `createLive2DLipSync`), gaze (`ParamEyeBallX/Y` via
  `animation.ts` `useLive2DIdleEyeFocus`). Blink toggles:
  `settings/live2d/auto-blink-enabled`, `settings/live2d/force-auto-blink-enabled`
  (needed when a model has only an idle motion — see `Model.vue` FIXME ~line 327).
- **Neru preseed** — `apps/stage-tamagotchi/src/renderer/neruPreseed.ts` already
  seeds LLM/STT/TTS providers + the persona card into localStorage; it does **not**
  set a stage model today. This is where we set the witch as neru's default.

## Approach

### 1. Package the model (ASCII-normalized zip)

The Japanese filenames (`魔女.*`) *may* work (JSZip resolves in-archive), but
non-ASCII names risk subtle failures in OPFS cache keys and blob URLs. **De-risk
by normalizing to ASCII** when producing the bundled zip:

- rename `魔女.moc3` → `witch.moc3`, `魔女.8192/` → `witch.8192/`,
  `魔女.model3.json` → `witch.model3.json`, `魔女.physics3.json` →
  `witch.physics3.json`, `魔女.cdi3.json` → `witch.cdi3.json`
- rewrite `witch.model3.json` `FileReferences` (`Moc`, `Textures`, `Physics`,
  `DisplayInfo`) to the new names. Motions/expressions filenames are already
  ASCII (`Scene1.motion3.json`, `cw.exp3.json`, …) — leave them.
- output `packages/stage-ui/src/assets/live2d/models/neru_witch.zip`

The model asset stays **on disk, untracked** — the models dir is deliberately
gitignored (`airi/.gitignore:81` `**/assets/live2d/models/*`) and the stock
Hiyori zips are untracked the same way. Vite resolves the preset URL from disk,
so the local app loads it regardless of git tracking. `~/Downloads/neru-witch-live2d.zip`
is the backup of record. (Corrects the earlier assumption that Hiyori is committed —
it is not; no model zip is tracked in this repo.)

Expression `Name`s inside `model3.json` (`cw`, `fz`, …) are unchanged — Phase 2
maps against them.

### 2. Register as a preset

Add a preset entry to `display-models.ts` mirroring the Hiyori Pro entry:
`new URL('../assets/live2d/models/neru_witch.zip', import.meta.url)`, format
`Live2dZip`, `type: 'url'`, a stable `id` (e.g. `preset-live2d-neru-witch`), name
`"neru (witch)"`. Keep the Hiyori presets (fallback/options) — no deletion.

### 3. Make it neru's default — seed once, respect the user's later choice

In `neruPreseed.ts`, seed `localStorage['settings/stage/model']` to the witch
preset id **once**, then never touch it again — so a user who picks a different
avatar in the UI keeps it across reboots.

The gate is a **separate neru-owned sentinel key** `neru/stage-model-seeded`, NOT
the target key:

```ts
if (!localStorage.getItem('neru/stage-model-seeded')) {
  assertRaw('settings/stage/model', NERU_WITCH_PRESET_ID)
  assertRaw('neru/stage-model-seeded', 'true')
}
```

Why a sentinel rather than "only if the target is unset": `neruPreseed.ts:4-8`
documents that guarding on the *target* key fails — the AIRI store
(`useLocalStorageManualReset('settings/stage/model', 'preset-live2d-1')`,
`stage-model.ts:18`) writes the Hiyori default into localStorage, so the target
key is never reliably "unset." The sentinel is written only by neru and the AIRI
store never touches it, so it is a truthful "has neru seeded the avatar yet?"
flag. `preseedNeruProviders()` runs at
`apps/stage-tamagotchi/src/renderer/main.ts:7`, before Pinia/store init, so on
the first boot our witch value is in place before the store would write its
default; on later boots the sentinel short-circuits and the user's selection
(witch or otherwise) is preserved. Unlike the provider keys (asserted every boot
out of functional necessity), the avatar is cosmetic, so seed-once is the right
policy. AIRI's generic default (`stage-model.ts:18`) is untouched.

### 4. Verify auto-behaviors

Confirm at implementation (visual): blink, lip-sync (mouth tracks TTS audio),
gaze. If blink doesn't fire because the model has only an idle motion, enable
`settings/live2d/force-auto-blink-enabled` (default true) — verify the default
holds for a preseeded neru boot. If gaze `ParamEyeBallX/Y` is absent, accept
no-op (non-fatal, note for Phase 2/follow-up).

### 5. Catalog the 12 expressions (Phase 2 input)

With the model rendered, apply each of the 12 expressions via the manual
expression UI (`packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue`),
capture a screenshot + one-line description per expression. Deliverable: a small
catalog table (exp `Name` → visual description → candidate emotion) committed to
the repo (e.g. `docs/superpowers/specs/neru-witch-expression-catalog.md`).

## Error handling / fallback

Model load failure falls back to Hiyori (loader already handles missing files;
`setParameterValueById` on a missing param is a harmless no-op, so a partial rig
won't crash). If the ASCII-normalized zip fails to load, that's a packaging bug
to fix, not a runtime fallback concern.

## Testing / verification

Live2D rendering is not unit-testable; verification is primarily **visual/manual**:

- **Manual (primary):** app boots → witch renders as default; eyes blink; TTS
  playback moves the mouth; (gaze if params present). Expression catalog captured.
- **Unit (where cheap):** `neruPreseed` seed-once semantics (jsdom env,
  `localStorage`): (a) fresh storage → witch id written + sentinel set; (b)
  sentinel unset but a stale `preset-live2d-1` present (AIRI default) → witch
  claims it; (c) sentinel already set + a user's selection present → left
  untouched. The preset entry itself (`display-models.ts`) is a private const
  loaded via IndexedDB, so it's verified by typecheck + build + manual render
  rather than a unit test.
- **Build:** `pnpm -F @proj-airi/stage-tamagotchi build` succeeds with the +38 MB
  asset (Hiyori Pro at 31.6 MB proves the size is fine).

## Out of scope (Phase 1)

- Emotion→expression wiring (Phase 2).
- Expression↔emotion semantic mapping decisions (Phase 2, informed by the catalog).
- Rebranding `productName` (separate follow-up).
- Trimming/optimizing the 8192px textures (only if load time proves a problem).

## Open risks

- **Gaze param** `ParamEyeBallX/Y` presence — verify; non-fatal if missing.
- **Force-auto-blink default** on a preseeded boot — verify blink actually fires.
- **ASCII normalization** must keep `model3.json` internally consistent — a
  mismatch between `FileReferences` and renamed files breaks the load.
