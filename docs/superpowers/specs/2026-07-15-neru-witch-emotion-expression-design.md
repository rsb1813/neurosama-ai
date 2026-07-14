<!-- M-E Phase 2 설계 스펙 — neru 마녀 모델의 감정(9종)→exp3 표정 배선 + 시각 카탈로그. Phase 1(렌더+자동동작)은 완료·머지됨(PR #19). -->
# neru Witch Avatar — Emotion → Expression Wiring (M-E Phase 2) Design

**Status:** Approved design (user approved 2026-07-15, autonomous /goal run).
**Milestone:** M-E (neru "witch" Live2D model), **Phase 2 of 2**.
**Branch:** `feat/neru-witch-emotion`.
**Depends on:** Phase 1 (PR #19, merged) — witch renders as default with working
expression registration in the stage window.

## Goal

Drive neru's facial **expressions** from her **emotions**: when the LLM emits an
emotion, the witch model shows the mapped exp3 expression, one at a time, held
briefly, then relaxes back to neutral. AIRI has **no emotion→Live2D-exp3 mapping
today** (Live2D emotions map only to *motion groups*; the witch has no
emotion-named motions, so its 12 exp3 expressions are the only emotional
surface). This phase builds that glue.

## Verified root cause context (why this is unblocked)

Phase 1 left "No expressions available for this model" in the settings panel.
**Runtime evidence (2026-07-15) proved this is a settings-panel-only cosmetic
issue, not a registration failure:** the Live2D model runs in the **main stage
window** and registers all 12 exp3 into *that window's* Pinia store
(`[exp-diag] registerExpressions groups=12`), with all 12 exp3 fetches returning
200. The expression **settings panel** (`model-settings/live2d.vue`) runs in a
**separate settings BrowserWindow** with its own isolated Pinia where no model
runs, so its store stays empty. `createPinia()` is plain (no cross-window sync;
only chat has a dedicated sync store).

**Consequence:** emotion→exp3 driving happens entirely in the stage window
(`Stage.vue` + the expression store + `applyExpressions` per frame), where the
store IS populated. So this feature does **not** require fixing the cross-window
panel. The panel fix is out of scope (see below).

## Scope

**In scope:**
- Part A — a throwaway **stage preview harness** to capture each of the 12 exp3
  applied to the live model → a **visual catalog** (fills the "Visual" column of
  `docs/superpowers/specs/neru-witch-expression-catalog.md`).
- Part B — the **emotion→exp3 wiring**: a witch-specific emotion→expression map,
  an `applyEmotion` action on the expression store, and a one-line hook in
  `Stage.vue`'s emotion handler.

**Out of scope:**
- The cross-window expression **settings panel** (still shows "No expressions
  available"). Cosmetic; documented as a known issue. A future fix would broadcast
  registered groups stage→settings via eventa IPC, or re-parse `model3.json` in
  the settings window.
- Emotion **intensity** scaling — v1 applies the full exp3 target value; the
  `EmotionPayload.intensity` field is ignored (noted as future).
- Generic per-model expression config — the map is witch-specific (neru is a
  single-model appliance). Extensibility deferred.

## Research anchors (verified by code reading)

- **Emotions** (`packages/stage-ui/src/constants/emotions.ts`): 9-value `Emotion`
  enum (`happy, sad, angry, think, surprised, awkward, question, curious,
  neutral`). Existing per-surface maps: `EMOTION_EmotionMotionName_value`
  (Live2D motion groups), `EMOTION_VRMExpressionName_value`
  (`Record<Emotion, string | undefined>`), `EMOTION_SpineAnimationName_value`.
  The new map mirrors the VRM one's shape.
- **Emotion handler** (`packages/stage-ui/src/components/scenes/Stage.vue`):
  `emotionsQueue` (~line 166) consumes `EmotionPayload`s enqueued from the LLM
  token stream (`act.emotion` → `toStageEmotionPayload` → `emotionsQueue.enqueue`,
  ~line 221). The **Live2D branch** (~line 178) currently sets only the motion
  group: `currentMotion.value = { group: EMOTION_EmotionMotionName_value[ctx.data.name] }`.
  This is where the exp3 hook is added. `Stage.vue` lives in `stage-ui`, rendered
  in the **stage (main) window** — the window whose expression store is populated.
- **Expression store** (`packages/stage-ui-live2d/src/stores/expression-store.ts`,
  Pinia id `live2d-expressions`): holds `expressionGroups` (name → group with
  `parameters: { parameterId, blend, value }[]`) and `expressions` (paramId →
  entry with `currentValue/defaultValue/modelDefault/targetValue`). Key existing
  actions:
  - `set(name, value, duration?)` — sets EVERY param of a group to the **same**
    `value`. **Wrong for activation** because a group's params have different exp3
    target values (`param.value`).
  - `toggle(name, duration?)` — activation path sets each param to its own exp3
    `param.value` (the correct activation values); used as the reference for
    `applyEmotion`.
  - private `applyValue(entry, value, duration?)` — sets `entry.currentValue` and,
    if `duration > 0`, schedules an auto-reset to `entry.defaultValue` after
    `duration` seconds.
  - `resetAll()` — sets every entry's `currentValue = modelDefault`.
- **Per-frame application** (`expression-controller.ts` `applyExpressions`,
  registered as a `final` motion-update plugin in `Model.vue`): reads
  `store.expressions` every frame and writes non-noop values onto the Cubism core
  model. So once `applyEmotion` mutates store entries, the change is rendered
  automatically. Multiply-blend params read the post-blink frame value, so
  auto-blink is preserved.

## Part A — Stage preview harness → visual catalog

**Purpose:** we cannot map 9 emotions to 12 opaquely-named exp3 (`cw, fz, h, hdj,
ku, mz, sq, x, xx, yj, zs1, zs2`) without seeing them. The preliminary catalog is
parameter-based guesses only.

**Mechanism (throwaway, reverted after):**
- A temporary harness in the stage window that, once the witch model is loaded
  with expressions registered, iterates the 12 groups: for each, `resetAll()`
  then activate that one group (set each param to its exp3 `param.value`), wait a
  short settle (~600 ms for fade/physics), and signal "ready to capture".
- Capture via Electron `webContents.capturePage()` from the **main process**
  (the main window's `webContents`), saving `witch-exp-<name>.png` to the
  scratchpad. Renderer↔main coordination reuses the existing eventa/IPC pattern
  OR a minimal temp channel; the simplest reliable form: the renderer drives the
  cycle and pokes a temp IPC per step, the main process captures on each poke.
- The controller (me) reads the 12 PNGs, writes a one-line visual description per
  expression, and finalizes the catalog table: exp name → visual → candidate
  emotion.

**Fallback:** if `capturePage` proves unreliable (transparent window, timing) and
fails 3 times, fall back to the preliminary **parameter-based** catalog already in
`neru-witch-expression-catalog.md`, record the fallback in the ledger, and proceed
to Part B with best-guess mappings (correctness lower; note for later visual pass).

**Nothing from Part A ships** — all harness/instrumentation is reverted (verified
by `git status` clean and no marker strings in tracked source), exactly like the
Phase-1 diagnostic instrumentation.

## Part B — Emotion → exp3 wiring

### B1. The map (constants)

Add to `packages/stage-ui/src/constants/emotions.ts`, mirroring
`EMOTION_VRMExpressionName_value`:

```ts
// neru 마녀 모델 전용 — 9개 감정을 witch exp3 표정 이름(또는 undefined=표정 없음/중립)으로 매핑.
// 값은 Phase 2 Part A 시각 카탈로그로 확정한다. undefined인 감정은 중립(모든 표정 리셋)으로 처리.
export const EMOTION_Live2DWitchExpressionName_value = {
  [Emotion.Happy]: /* from catalog */ undefined,
  [Emotion.Sad]: 'ku', // 예비: distressed brow (down, rounded)
  [Emotion.Angry]: 'sq', // 예비: angry brow (down + angled)
  [Emotion.Think]: undefined,
  [Emotion.Surprise]: undefined,
  [Emotion.Awkward]: undefined,
  [Emotion.Question]: undefined,
  [Emotion.Curious]: undefined,
  [Emotion.Neutral]: undefined, // 중립 = 표정 없음(리셋)
} satisfies Record<Emotion, string | undefined>
```

The `undefined` placeholders are filled from Part A. `Emotion.Neutral` stays
`undefined` (neutral = reset). An emotion with no good expression stays
`undefined` (no-op beyond resetting the previous expression). The map name is
witch-specific to leave room for other models later without a false "generic"
promise.

### B2. `applyEmotion` action (expression store)

Add to `useExpressionStore`:

```ts
// 활성 감정 표정을 추적 — 새 감정이 오면 이전 것을 먼저 리셋해 "한 번에 하나"를 보장한다.
const activeEmotionGroup = ref<string | null>(null)

/**
 * Apply the expression mapped to an emotion: reset the previously-active
 * emotion expression, then activate the new group by setting each of its
 * parameters to that group's exp3 target value, auto-reset to neutral after
 * `holdSeconds`. Unknown/undefined expression name → reset only (neutral).
 * No-op when the group is not registered (model has no such expression).
 */
function applyEmotion(expressionName: string | undefined, holdSeconds = 4): void { ... }
```

Semantics:
1. If `activeEmotionGroup` is set, reset its params to `modelDefault` (clear the
   previous expression immediately) and clear the tracker.
2. If `expressionName` is `undefined` or not in `expressionGroups`, stop here
   (neutral / unknown → just relaxed).
3. Otherwise, for each `param` of the group, set the matching entry's value to
   the exp3 target `param.value` with `duration = holdSeconds` (reuse
   `applyValue`'s existing auto-reset timer, which returns the param to its
   default after the hold). Record `activeEmotionGroup = expressionName`.

**Reset-target note:** `applyValue`'s timer resets to `entry.defaultValue`. neru
never calls `saveDefaults()`, so `defaultValue === modelDefault` (neutral) and the
relax-to-neutral behavior is correct. The design relies on this; if per-user
expression defaults are ever introduced, `applyEmotion`'s reset must target
`modelDefault` explicitly.

`dispose()` also clears `activeEmotionGroup`.

### B3. Hook in `Stage.vue`

In the `emotionsQueue` Live2D branch (~line 178), keep the existing motion-group
line unchanged and add one line:

```ts
currentMotion.value = { group: EMOTION_EmotionMotionName_value[ctx.data.name] }
expressionStore.applyEmotion(EMOTION_Live2DWitchExpressionName_value[ctx.data.name])
```

`expressionStore` is obtained via `useExpressionStore()` in `Stage.vue`'s setup.
When the model has no registered expressions (e.g., Hiyori), `applyEmotion` is a
no-op (empty `expressionGroups`), so **other models are unaffected** and the
motion path is untouched.

## Data flow

```
LLM token stream → act.emotion → toStageEmotionPayload → emotionsQueue.enqueue
  → (Live2D branch) currentMotion = motion group   [unchanged]
                  + expressionStore.applyEmotion(map[emotion])   [new]
                      → reset previous group → activate mapped group's params to
                        exp3 targets, hold 4s, auto-reset to neutral
  → applyExpressions (per frame) writes entry values onto the Cubism core model
  → witch shows the expression, then relaxes
```

## Error handling / edge cases

- **Unknown/undefined mapping:** reset-only (relax to neutral). Never throws.
- **Group not registered** (wrong model / expressions disabled): no-op.
- **Rapid emotion changes:** each `applyEmotion` resets the previous group first,
  so at most one emotion expression is active; the newest wins.
- **Auto-blink interaction:** unaffected — blink params are Multiply/refreshed per
  frame before `applyExpressions`; emotion expressions touch brow/mouth/custom
  params, not the blink open params (verified against the exp3 parameter sets).

## Testing / verification

- **Unit (Vitest, jsdom)** on `applyEmotion` against a store seeded via
  `registerExpressions` with 2–3 fake groups:
  - maps a known emotion-expression name → that group's params take their exp3
    target values; `activeEmotionGroup` is set.
  - a second `applyEmotion` with a different name → previous group's params are
    back at `modelDefault`, new group active (one-at-a-time).
  - `undefined` name → previous group reset, nothing activated.
  - unregistered name → no throw, no active group.
  - `holdSeconds` passed through to the reset timer (assert timer scheduled;
    fake timers).
- **Type/lint:** `EMOTION_Live2DWitchExpressionName_value satisfies
  Record<Emotion, string | undefined>` guarantees all 9 emotions are covered.
- **Manual (primary for visuals):** with the witch rendered, trigger emotions
  (via chat) and confirm the mapped expression shows and relaxes. Covered
  informally during Part A capture; full manual pass is a human step after merge.
- The `Stage.vue` one-liner and the constant map are verified by typecheck +
  build + the unit tests above (Stage.vue itself is not unit-tested here).

## Files

- **Create:** `packages/stage-ui-live2d/src/stores/expression-store.emotion.test.ts`
  (or extend an existing store test) — `applyEmotion` unit tests.
- **Modify:** `packages/stage-ui/src/constants/emotions.ts` — add the witch map.
- **Modify:** `packages/stage-ui-live2d/src/stores/expression-store.ts` — add
  `activeEmotionGroup` + `applyEmotion`, expose it, clear in `dispose`.
- **Modify:** `packages/stage-ui/src/components/scenes/Stage.vue` — import the map,
  call `applyEmotion` in the Live2D emotion branch.
- **Update:** `docs/superpowers/specs/neru-witch-expression-catalog.md` — fill the
  Visual column + finalized emotion mapping (from Part A).
- **Temp (reverted):** stage preview harness + capture wiring (Part A only).

## Open risks

- **`capturePage` on a transparent stage window** may yield blank/alpha frames or
  race the fade — mitigated by the settle delay and the 3-try → param-catalog
  fallback.
- **Expression coverage:** if the visual catalog shows fewer than 9 usable
  emotional expressions, some emotions map to `undefined` (relax to neutral) —
  acceptable; better than a wrong mapping.
- **Reset target = defaultValue** assumption (see B2 note) — safe as long as neru
  never persists expression defaults.
