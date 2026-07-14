# neru Witch Avatar — Render + Auto-Behaviors (M-E Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the neru witch Live2D model AIRI's default avatar with working auto blink / gaze / lip-sync, and produce a catalog of its 12 expressions for Phase 2.

**Architecture:** Bundle an ASCII-normalized `neru_witch.zip` as a Live2D preset in `stage-ui` (mirroring the Hiyori Pro preset), and assert it as neru's stage model in the desktop `neruPreseed` bootstrap. AIRI's existing Live2D loader + per-frame auto-behavior plugins drive the standard Cubism parameters the model already declares.

**Tech Stack:** Vue 3 / Electron (stage-tamagotchi), Pinia, `pixi-live2d-display/cubism4`, Vitest (jsdom env for localStorage), Cubism 4 (`.moc3`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-14-neru-witch-avatar-render-design.md`.
- The witch preset id is the single string `'preset-live2d-neru-witch'`, defined once in `packages/stage-ui/src/constants/neru-witch.ts` and imported everywhere (no duplicated literal).
- The bundled model file is `packages/stage-ui/src/assets/live2d/models/neru_witch.zip`, referenced via `new URL('../assets/live2d/models/neru_witch.zip', import.meta.url).href` (exact Hiyori pattern, `display-models.ts:22`).
- All model-internal filenames must be **ASCII** (no `魔女`); `model3.json` `FileReferences` must stay internally consistent with the renamed files.
- neru **seeds** its stage model to the witch **once**, gated by a neru-owned sentinel key `neru/stage-model-seeded` (NOT the target key). After the first seed, a user's later avatar choice is preserved across reboots. Do NOT guard on `settings/stage/model` itself — `neruPreseed.ts:4-8` documents that the AIRI store writes the Hiyori default into that key, so it is never reliably "unset"; the sentinel is written only by neru.
- New source files start with a one-line Korean header comment (project rule). Follow existing AIRI patterns (`airi/AGENTS.md`); prefer functional style; camelCase filenames.
- Do not delete the Hiyori presets. Do not change AIRI's generic default (`stage-model.ts:18`).

---

### Task 1: Package the ASCII-normalized witch model zip

**Files:**
- Create: `airi/packages/stage-ui/src/assets/live2d/models/neru_witch.zip` (binary asset, committed)
- Source (read-only, not in repo): `C:/Users/jolib/Downloads/neru-witch-live2d.zip`

**Interfaces:**
- Produces: a zip whose entries are `witch.model3.json`, `witch.moc3`, `witch.8192/texture_00.png`, `witch.8192/texture_01.png`, `witch.physics3.json`, `witch.cdi3.json`, `Scene1.motion3.json`, and the 12 `*.exp3.json` files. `witch.model3.json` `FileReferences` point at the ASCII names. Expression `Name`s (`cw, fz, h, hdj, ku, mz, sq, x, xx, yj, zs1, zs2`) are unchanged.

This is a one-time asset-generation task (no unit test — verification is structural validation of the produced zip). **Do it entirely in Python** (`python3` is available; the `zip` binary is NOT, and shelling `mv` on the `魔女` filenames risks encoding issues). One pass: read the source zip, rewrite every `魔女`-prefixed entry name to `witch`, rewrite the `model3.json` text the same way, write the output zip, then validate.

- [ ] **Step 1: Produce the ASCII-normalized zip from the source, in one pass**

```bash
cd "C:/Users/jolib/Documents/neurosama-ai/airi"
python3 - <<'PY'
import zipfile
SRC = 'C:/Users/jolib/Downloads/neru-witch-live2d.zip'
OUT = 'packages/stage-ui/src/assets/live2d/models/neru_witch.zip'
def norm(name):  # '魔女.moc3'->'witch.moc3', '魔女.8192/x.png'->'witch.8192/x.png'
    return name.replace('魔女', 'witch')
with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        if item.is_dir():
            continue  # entries carry full paths; explicit dir records aren't needed
        data = zin.read(item.filename)
        new = norm(item.filename)
        # The model3.json body references the renamed files by name — rewrite them too.
        if new.endswith('model3.json'):
            data = data.decode('utf-8').replace('魔女', 'witch').encode('utf-8')
        zout.writestr(new, data)
print('wrote', OUT)
PY
```
Expected: `wrote packages/stage-ui/src/assets/live2d/models/neru_witch.zip`.

- [ ] **Step 2: Validate the output zip — ASCII names + every model3.json reference resolves**

```bash
cd "C:/Users/jolib/Documents/neurosama-ai/airi"
python3 - <<'PY'
import zipfile, json
OUT = 'packages/stage-ui/src/assets/live2d/models/neru_witch.zip'
with zipfile.ZipFile(OUT) as z:
    names = set(z.namelist())
    assert not any('魔女' in n for n in names), f'non-ASCII entry remains: {[n for n in names if "魔女" in n]}'
    assert 'witch.model3.json' in names, 'witch.model3.json missing'
    d = json.loads(z.read('witch.model3.json').decode('utf-8'))
    fr = d['FileReferences']
    refs = [fr['Moc'], fr['Physics'], fr['DisplayInfo']] + fr['Textures']
    refs += [m['File'] for m in fr['Motions']['idle']]
    refs += [e['File'] for e in fr['Expressions']]
    missing = [r for r in refs if r not in names]
    assert not missing, f'unresolved references: {missing}'
    assert '魔女' not in json.dumps(d, ensure_ascii=False), 'model3.json still contains 魔女'
    print('OK -', len(names), 'entries, all', len(refs), 'references resolve, all ASCII')
PY
```
Expected: `OK - 20 entries, all 17 references resolve, all ASCII` (counts may differ slightly; the assertions are what matter).

- [ ] **Step 3: Commit the asset**

```bash
cd "C:/Users/jolib/Documents/neurosama-ai"
git add airi/packages/stage-ui/src/assets/live2d/models/neru_witch.zip
git commit -m "feat(stage-ui): bundle ASCII-normalized neru witch Live2D model asset"
```

---

### Task 2: Register the witch as a Live2D preset

**Files:**
- Create: `airi/packages/stage-ui/src/constants/neru-witch.ts`
- Modify: `airi/packages/stage-ui/src/stores/display-models.ts` (add url const near line 22-24; add preset entry in `displayModelsPresets`, line 50-55)

**Interfaces:**
- Consumes: `neru_witch.zip` asset from Task 1.
- Produces: `export const NERU_WITCH_PRESET_ID = 'preset-live2d-neru-witch'` from `@proj-airi/stage-ui/constants/neru-witch`; a preset entry with that id, `format: DisplayModelFormat.Live2dZip`, `type: 'url'`, in the display-models catalog.

Verification is typecheck + build (the asset URL resolves and the catalog is well-formed); the preset const is module-private and the catalog loads from IndexedDB, so there is no cheap unit test — runtime render is checked in Task 4.

- [ ] **Step 1: Create the side-effect-free preset-id constant**

`airi/packages/stage-ui/src/constants/neru-witch.ts`:
```ts
// neru 마녀 Live2D 프리셋의 안정적 id — display-models 프리셋과 neruPreseed가 공유한다.
export const NERU_WITCH_PRESET_ID = 'preset-live2d-neru-witch'
```

- [ ] **Step 2: Add the asset URL and preset entry in `display-models.ts`**

After `display-models.ts:24` (the `presetLive2dPreview` line), add:
```ts
const presetLive2dNeruWitchUrl = new URL('../assets/live2d/models/neru_witch.zip', import.meta.url).href
```
Add the import near the top (with the other imports):
```ts
import { NERU_WITCH_PRESET_ID } from '../constants/neru-witch'
```
Add this entry as the **first** element of `displayModelsPresets` (line 50 array), so neru's model heads the catalog:
```ts
  { id: NERU_WITCH_PRESET_ID, format: DisplayModelFormat.Live2dZip, type: 'url', url: presetLive2dNeruWitchUrl, name: 'neru (witch)', importedAt: 1733113886840 },
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @proj-airi/stage-ui typecheck`
Expected: exit 0 (no type errors).

- [ ] **Step 4: Lint the changed files (Windows ESLint workaround)**

Run from `airi/`:
```bash
node node_modules/eslint/bin/eslint.js packages/stage-ui/src/constants/neru-witch.ts packages/stage-ui/src/stores/display-models.ts
```
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add airi/packages/stage-ui/src/constants/neru-witch.ts airi/packages/stage-ui/src/stores/display-models.ts
git commit -m "feat(stage-ui): register neru witch as a Live2D preset"
```

---

### Task 3: Seed the witch as neru's default stage model, once (TDD)

**Files:**
- Modify: `airi/apps/stage-tamagotchi/src/renderer/neruPreseed.ts` (add a sentinel-gated seed block in `preseedNeruProviders`, plus the import)
- Test: `airi/apps/stage-tamagotchi/src/renderer/neruPreseed.test.ts` (new)

**Interfaces:**
- Consumes: `NERU_WITCH_PRESET_ID` from `@proj-airi/stage-ui/constants/neru-witch`; the existing `assertRaw(key, value)` helper (`neruPreseed.ts:18`) and `preseedNeruProviders()` (`neruPreseed.ts:67`).
- Produces: on first run (sentinel `neru/stage-model-seeded` unset), `localStorage['settings/stage/model'] === NERU_WITCH_PRESET_ID` and the sentinel is set to `'true'`. Once the sentinel is set, `settings/stage/model` is left untouched (user's choice preserved).

- [ ] **Step 1: Write the failing test**

`airi/apps/stage-tamagotchi/src/renderer/neruPreseed.test.ts`:
```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { NERU_WITCH_PRESET_ID } from '@proj-airi/stage-ui/constants/neru-witch'

import { preseedNeruProviders } from './neruPreseed'

const STAGE_MODEL_KEY = 'settings/stage/model'
const SEEDED_KEY = 'neru/stage-model-seeded'

describe('preseedNeruProviders — stage model (seed once)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('seeds the witch model and marks the sentinel on first run', () => {
    preseedNeruProviders()
    expect(localStorage.getItem(STAGE_MODEL_KEY)).toBe(NERU_WITCH_PRESET_ID)
    expect(localStorage.getItem(SEEDED_KEY)).toBe('true')
  })

  it('claims the witch over a stale AIRI Hiyori default when the sentinel is unset', () => {
    // AIRI store may have written its 'preset-live2d-1' default before neru first seeds.
    localStorage.setItem(STAGE_MODEL_KEY, 'preset-live2d-1')
    preseedNeruProviders()
    expect(localStorage.getItem(STAGE_MODEL_KEY)).toBe(NERU_WITCH_PRESET_ID)
  })

  it('preserves the user\'s later avatar choice once the sentinel is set', () => {
    localStorage.setItem(SEEDED_KEY, 'true')
    localStorage.setItem(STAGE_MODEL_KEY, 'preset-live2d-2')
    preseedNeruProviders()
    expect(localStorage.getItem(STAGE_MODEL_KEY)).toBe('preset-live2d-2')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run apps/stage-tamagotchi/src/renderer/neruPreseed.test.ts`
Expected: FAIL — first two tests find no witch id / no sentinel (the seed block isn't wired yet). The third may pass incidentally (nothing writes the key), which is fine — it guards the final behavior.

- [ ] **Step 3: Wire the sentinel-gated seed**

In `neruPreseed.ts`, add the import next to the existing stage-ui import (`neruPreseed.ts:13`):
```ts
import { NERU_WITCH_PRESET_ID } from '@proj-airi/stage-ui/constants/neru-witch'
```
In `preseedNeruProviders()`, immediately after the onboarding line (`neruPreseed.ts:91`, `assertRaw('onboarding/completed', 'true')`), add:
```ts
  // neru의 기본 아바타를 마녀 모델로 최초 1회만 시드한다 — 이후 사용자가 UI에서 바꾼 선택을 존중한다.
  // 대상 키(settings/stage/model)는 AIRI 스토어가 Hiyori 기본값을 써버려 "없을 때만" 판정이
  // 무력화되므로, 우리만 쓰는 별도 센티넬 키로 최초 1회 여부를 판정한다.
  if (!localStorage.getItem('neru/stage-model-seeded')) {
    assertRaw('settings/stage/model', NERU_WITCH_PRESET_ID)
    assertRaw('neru/stage-model-seeded', 'true')
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run apps/stage-tamagotchi/src/renderer/neruPreseed.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm -F @proj-airi/stage-tamagotchi typecheck` → exit 0.
Run from `airi/`: `node node_modules/eslint/bin/eslint.js apps/stage-tamagotchi/src/renderer/neruPreseed.ts apps/stage-tamagotchi/src/renderer/neruPreseed.test.ts` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add airi/apps/stage-tamagotchi/src/renderer/neruPreseed.ts airi/apps/stage-tamagotchi/src/renderer/neruPreseed.test.ts
git commit -m "feat(stage-tamagotchi): preseed neru witch as the default stage model"
```

---

### Task 4: Manual verification + expression catalog

**Files:**
- Create: `docs/superpowers/specs/neru-witch-expression-catalog.md`

**Interfaces:**
- Consumes: the running app with the witch preseeded (Tasks 1-3).
- Produces: a committed catalog table mapping each of the 12 expression `Name`s to a visual description + candidate emotion — the input Phase 2 needs.

This task is manual/visual (Live2D rendering isn't unit-testable). It is the milestone's real acceptance gate.

- [ ] **Step 1: Build check (asset resolves in the bundle)**

Run: `pnpm -F @proj-airi/stage-tamagotchi build`
Expected: exit 0; the renderer build emits `neru_witch.zip` as a hashed asset (as it does for `hiyori_pro_zh.zip`).

- [ ] **Step 2: Launch the app and confirm the witch renders as default**

From `airi/`, run `pnpm desktop` (this also spawns the neru-audio gateway on 3457; do not kill the LLM proxy on 3456). On a fresh localStorage the stage should show the **witch**, not Hiyori.
Verify: witch model visible and centered. If it does not appear, check the renderer console for zip-load / model3.json / parameter errors and fix packaging (Task 1) or the preset URL (Task 2).

- [ ] **Step 3: Confirm auto blink and gaze**

Observe for ~30 s: eyes blink periodically; eyes make small idle movements (gaze).
If blink does not fire (model has only an idle motion — see `Model.vue` FIXME ~line 327), enable Force Auto Blink: set `localStorage['settings/live2d/force-auto-blink-enabled']` truthy (it defaults on — confirm it is actually on for a preseeded boot) and reload.
If gaze does not move, confirm the model exposes `ParamEyeBallX/Y`; if absent, record it as a known no-op (non-fatal) for a follow-up.

- [ ] **Step 4: Confirm lip-sync**

Send neru a message so it speaks (TTS). Watch the mouth track the audio (`ParamMouthOpenY` driven by `mouthOpenSize`).
Expected: mouth opens/closes with speech, closes to rest afterward. If the mouth stays static, confirm the model's `LipSync` group (`ParamMouthOpenY`) loaded and that TTS audio is actually playing (gateway 200s).

- [ ] **Step 5: Capture the 12-expression catalog**

Open the manual expression UI (`packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue` — the model settings panel). Apply each expression `Name` in turn: `cw, fz, h, hdj, ku, mz, sq, x, xx, yj, zs1, zs2`. For each, note what changes on the face.

Write `docs/superpowers/specs/neru-witch-expression-catalog.md` with a table:

```markdown
<!-- neru 마녀 모델 표정 12개 카탈로그 — Phase 2 감정→표정 매핑의 입력. -->
# neru Witch — Expression Catalog (Phase 2 input)

| exp Name | Visual description | Candidate emotion |
|----------|--------------------|-------------------|
| cw  | <what it looks like> | <happy/sad/angry/think/surprised/awkward/question/curious/neutral or "none"> |
| ... | ... | ... |
```
Fill every row from observation (not guesswork). Known param hints to confirm: `sq` sets an angry-form brow (candidate: angry); `ku` sets a distressed brow (candidate: sad); `x`/`xx` toggle `Param59/60` (candidate: happy/smile variants).

- [ ] **Step 6: Commit the catalog**

```bash
git add docs/superpowers/specs/neru-witch-expression-catalog.md
git commit -m "docs: neru witch 12-expression catalog (Phase 2 input)"
```

---

## Self-Review

**Spec coverage:** §Approach 1 (ASCII package) → Task 1. §2 (preset) → Task 2. §3 (preseed default, seed-once via sentinel) → Task 3. §4 (auto-behaviors verify) → Task 4 Steps 2-4. §5 (expression catalog) → Task 4 Step 5. §Testing (unit for preseed; build; manual render) → Tasks 3 & 4. All spec sections mapped.

**Placeholder scan:** No TBD/TODO. The only free-text-to-fill is the expression catalog table (Task 4 Step 5) — inherent to a discovery deliverable, with explicit param hints and a "from observation, not guesswork" instruction.

**Type consistency:** `NERU_WITCH_PRESET_ID` is defined once (Task 2 Step 1) and consumed by the same import path in Task 2 (display-models), Task 3 (neruPreseed + test). The preset entry shape matches the existing `DisplayModelURL` interface (`display-models.ts:40-48`). `assertRaw` signature matches `neruPreseed.ts:18`.
