# neru Witch Emotion → Expression Wiring (M-E Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive neru's witch Live2D facial expressions from her emotions — when the LLM emits an emotion, show the mapped exp3 expression (one at a time, held ~4s, then relax to neutral).

**Architecture:** A witch-specific `Emotion → exp3-name` constant map; an `applyEmotion` action on the (stage-window) expression store that activates one expression group's params to their exp3 target values with an auto-reset timer; and a one-line hook in `Stage.vue`'s existing Live2D emotion branch. All in the stage window where the expression store is populated. The exact map values come from a throwaway stage-preview screenshot catalog (Part A).

**Tech Stack:** Vue 3 + Pinia (`packages/stage-ui`, `packages/stage-ui-live2d`), pixi-live2d-display, Vitest (jsdom), Electron (stage-tamagotchi, for Part A capture only).

## Global Constraints

- Branch `feat/neru-witch-emotion`. Commit per task. **NO PR / NO merge** — a human merges (autonomous /goal run).
- Never kill proxy PID 11712 (localhost:3456). If launching the app, clean up ports 5173/3457 after; revert all Part-A harness/instrumentation (verify `git status` clean + no marker strings in tracked source).
- New source file first line = one-line Korean role comment (§17). Comments in Korean; identifiers/strings English.
- Behavior: **one expression at a time**, short fade, **hold ~4s then auto-reset to neutral** (reuse the store's existing `applyValue` duration timer). Emotion→**motion** path stays unchanged; the exp3 path is **additive** and a **no-op when the model has no registered expressions** (other models unaffected).
- Emotion **intensity ignored** in v1 (apply full exp3 target value).
- Map constant name (exact, verbatim): `EMOTION_Live2DWitchExpressionName_value`, typed `satisfies Record<Emotion, string | undefined>` (all 9 emotions covered; `undefined` = neutral/no expression).
- `applyEmotion` reset relies on `entry.defaultValue === entry.modelDefault` (neru never calls `saveDefaults()`); resetting the previous group writes `entry.modelDefault` explicitly.
- Do NOT touch the cross-window settings-panel bug (out of scope, cosmetic).
- Spec: `docs/superpowers/specs/2026-07-15-neru-witch-emotion-expression-design.md`.

---

## File Structure

- `packages/stage-ui-live2d/src/stores/expression-store.ts` (MODIFY) — add `activeEmotionGroup` ref + `applyEmotion` action; expose it; clear it in `dispose()`.
- `packages/stage-ui-live2d/src/stores/expression-store.test.ts` (CREATE) — `applyEmotion` unit tests (jsdom + Pinia).
- `packages/stage-ui/src/constants/emotions.ts` (MODIFY) — add `EMOTION_Live2DWitchExpressionName_value`.
- `packages/stage-ui/src/components/scenes/Stage.vue` (MODIFY) — import the map + `useExpressionStore`, call `applyEmotion` in the Live2D emotion branch.
- `docs/superpowers/specs/neru-witch-expression-catalog.md` (MODIFY, Part A) — fill Visual column + finalized emotion mapping.
- Part-A harness: temporary, **reverted** — no shipped file.

---

## Task 1 (Part A): Stage preview harness → visual catalog

**Nature:** Controller-executed / manual (like Phase-1 Task 4), NOT a subagent TDD task. It produces the visual catalog and the finalized emotion→expression assignments that Task 3 transcribes. All harness code is reverted afterward.

**Files:**
- Temp modify (reverted): `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue` (renderer cycler) + `apps/stage-tamagotchi/src/main/windows/shared/window.ts` (temp IPC → `capturePage`), OR an equivalent minimal harness.
- Modify (kept): `docs/superpowers/specs/neru-witch-expression-catalog.md`.

**Definition of Done:** `neru-witch-expression-catalog.md` "Visual" column filled for all 12 exp3 with one-line descriptions, and a finalized "Candidate emotion" assignment for each of the 9 emotions (some may be `undefined`). OR, on capture failure, the param-based fallback is recorded.

- [ ] **Step 1: Add a temporary renderer cycler.** In `Model.vue`, guarded by a temp constant (e.g. `const EXP_CAPTURE = true`), after the model loads with expressions registered, iterate `expressionStore.expressionGroups`: for each `[name, group]`, call `expressionStore.resetAll()`, then set each `param.parameterId` entry to `param.value` (mirror `applyEmotion`'s activation), wait ~600ms, then invoke a temp IPC `neru:capture-exp` with `{ name }`. Log `[exp-cap] <name>` via console for the forwarder.

- [ ] **Step 2: Add a temporary main-process capture handler.** In `setupBaseWindowElectronInvokes` (`windows/shared/window.ts`), register a temp handler for `neru:capture-exp` that calls `params.window.webContents.capturePage()` and writes the PNG to the scratchpad as `witch-exp-<name>.png`. (Electron `NativeImage.toPNG()` → `fs.writeFile`.)

- [ ] **Step 3: Launch, capture, verify screenshots exist.** Launch the app (`pnpm desktop` to a log). Confirm 12 `witch-exp-*.png` appear in the scratchpad. Expected: 12 non-empty PNGs.

- [ ] **Step 4: Read screenshots + finalize catalog.** Controller reads the 12 PNGs, writes a one-line visual description per exp3, and decides the emotion→expression assignment (map each of the 9 emotions to the best-fit exp3 name or `undefined`). Fill the "Visual" column and add a finalized mapping block in `neru-witch-expression-catalog.md`.

- [ ] **Step 5 (fallback): If capture fails 3×,** stop retrying, record the failure in `.superpowers/sdd/progress.md`, and finalize the mapping from the existing **parameter-based** table (`sq`→angry, `ku`→sad, others best-guess or `undefined`).

- [ ] **Step 6: Revert all harness code.** `git checkout --` the temp-modified source files; confirm `git status` clean and `git grep` finds no `exp-cap`/`EXP_CAPTURE`/`neru:capture-exp` in tracked source. Kill the app (preserve PID 11712).

- [ ] **Step 7: Commit the catalog.**

```bash
git add docs/superpowers/specs/neru-witch-expression-catalog.md
git commit -m "docs: finalize witch expression visual catalog (M-E Phase 2 Part A)"
```

---

## Task 2 (Part B): `applyEmotion` action on the expression store

**Files:**
- Modify: `packages/stage-ui-live2d/src/stores/expression-store.ts`
- Create: `packages/stage-ui-live2d/src/stores/expression-store.test.ts`

**Interfaces:**
- Consumes: existing store internals — `expressionGroups: Ref<Map<string, ExpressionGroupDefinition>>` (group → `{ name, parameters: { parameterId, blend, value }[] }`), `expressions: Ref<Map<string, ExpressionEntry>>` (paramId → entry with `currentValue/modelDefault/...`), private `applyValue(entry, value, duration?)` (sets `currentValue`; if `duration>0` schedules reset to `entry.defaultValue`), `registerExpressions(id, groups, entries)`, `dispose()`.
- Produces: `applyEmotion(expressionName: string | undefined, holdSeconds = 4): void` — exposed on the store. Reset-previous-then-activate-one semantics.

- [ ] **Step 1: Write the failing tests.** Create `packages/stage-ui-live2d/src/stores/expression-store.test.ts`:

```ts
// @vitest-environment jsdom
import type { ExpressionEntry, ExpressionGroupDefinition } from './expression-store'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useExpressionStore } from './expression-store'

// 두 감정 표정 그룹(angry=Param67, sad=Param68)을 modelDefault 0으로 시드한다.
function seed() {
  const groups: ExpressionGroupDefinition[] = [
    { name: 'angry', parameters: [{ parameterId: 'Param67', blend: 'Add', value: 30 }] },
    { name: 'sad', parameters: [{ parameterId: 'Param68', blend: 'Add', value: 30 }] },
  ]
  const entries: ExpressionEntry[] = [
    { name: 'Param67', parameterId: 'Param67', blend: 'Add', currentValue: 0, defaultValue: 0, modelDefault: 0, targetValue: 30 },
    { name: 'Param68', parameterId: 'Param68', blend: 'Add', currentValue: 0, defaultValue: 0, modelDefault: 0, targetValue: 30 },
  ]
  return { groups, entries }
}

describe('useExpressionStore.applyEmotion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('activates the mapped group params to their exp3 target values', () => {
    const store = useExpressionStore()
    const { groups, entries } = seed()
    store.registerExpressions('test', groups, entries)
    store.applyEmotion('angry')
    expect(store.expressions.get('Param67')!.currentValue).toBe(30)
  })

  it('resets the previous group when a new emotion arrives (one at a time)', () => {
    const store = useExpressionStore()
    const { groups, entries } = seed()
    store.registerExpressions('test', groups, entries)
    store.applyEmotion('angry')
    store.applyEmotion('sad')
    expect(store.expressions.get('Param67')!.currentValue).toBe(0)
    expect(store.expressions.get('Param68')!.currentValue).toBe(30)
  })

  it('undefined name resets the previous group and activates nothing', () => {
    const store = useExpressionStore()
    const { groups, entries } = seed()
    store.registerExpressions('test', groups, entries)
    store.applyEmotion('angry')
    store.applyEmotion(undefined)
    expect(store.expressions.get('Param67')!.currentValue).toBe(0)
  })

  it('unregistered expression name does not throw and activates nothing', () => {
    const store = useExpressionStore()
    const { groups, entries } = seed()
    store.registerExpressions('test', groups, entries)
    expect(() => store.applyEmotion('nonexistent')).not.toThrow()
    expect(store.expressions.get('Param67')!.currentValue).toBe(0)
  })

  it('auto-resets to neutral after holdSeconds', () => {
    vi.useFakeTimers()
    const store = useExpressionStore()
    const { groups, entries } = seed()
    store.registerExpressions('test', groups, entries)
    store.applyEmotion('angry', 4)
    expect(store.expressions.get('Param67')!.currentValue).toBe(30)
    vi.advanceTimersByTime(4000)
    expect(store.expressions.get('Param67')!.currentValue).toBe(0)
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm exec vitest run packages/stage-ui-live2d/src/stores/expression-store.test.ts`
Expected: FAIL — `store.applyEmotion is not a function`.

- [ ] **Step 3: Implement `applyEmotion`.** In `expression-store.ts`, add the tracker ref near the other state (after `modelId`):

```ts
// 현재 활성 감정 표정 그룹 이름 — 새 감정이 오면 이전 것을 먼저 리셋해 "한 번에 하나"를 보장한다.
const activeEmotionGroup = ref<string | null>(null)
```

Add the action (place it after `resetAll`, before `dispose`):

```ts
/**
 * 감정에 매핑된 표정을 적용한다. 이전 감정 표정을 즉시 중립으로 되돌린 뒤,
 * 새 그룹의 각 파라미터를 그 그룹의 exp3 타깃값으로 활성화하고 holdSeconds 후 중립 복귀한다.
 * expressionName이 undefined이거나 미등록이면 이전 표정만 리셋한다(중립). 표정 미등록 모델에선 no-op.
 */
function applyEmotion(expressionName: string | undefined, holdSeconds = 4): void {
  // 이전 감정 표정을 즉시 modelDefault로 되돌린다(한 번에 하나).
  if (activeEmotionGroup.value) {
    const prev = expressionGroups.value.get(activeEmotionGroup.value)
    if (prev) {
      for (const param of prev.parameters) {
        const entry = expressions.value.get(param.parameterId)
        if (entry)
          applyValue(entry, entry.modelDefault)
      }
    }
    activeEmotionGroup.value = null
  }

  // 중립/무매핑/미등록 → 리셋만 하고 종료.
  if (!expressionName)
    return
  const group = expressionGroups.value.get(expressionName)
  if (!group)
    return

  // 각 파라미터를 exp3 타깃값으로 활성화하고 hold 후 자동 중립 복귀(applyValue의 duration 타이머 재사용).
  for (const param of group.parameters) {
    const entry = expressions.value.get(param.parameterId)
    if (entry)
      applyValue(entry, param.value, holdSeconds)
  }
  activeEmotionGroup.value = expressionName
}
```

Clear the tracker in `dispose()` (add the line alongside the existing resets):

```ts
    activeEmotionGroup.value = null
```

Expose it in the returned object (add to the Actions group):

```ts
    applyEmotion,
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm exec vitest run packages/stage-ui-live2d/src/stores/expression-store.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Typecheck + lint.**

Run: `pnpm -F @proj-airi/stage-ui-live2d typecheck` (expected: exit 0). Lint the two files: `node node_modules/eslint/bin/eslint.js packages/stage-ui-live2d/src/stores/expression-store.ts packages/stage-ui-live2d/src/stores/expression-store.test.ts` from the `airi` root (expected: no errors).

- [ ] **Step 6: Commit.**

```bash
git add packages/stage-ui-live2d/src/stores/expression-store.ts packages/stage-ui-live2d/src/stores/expression-store.test.ts
git commit -m "feat(stage-ui-live2d): add applyEmotion to the expression store"
```

---

## Task 3 (Part B): witch emotion → exp3 map constant

**Files:**
- Modify: `packages/stage-ui/src/constants/emotions.ts`

**Interfaces:**
- Consumes: the finalized emotion→expression assignment from Task 1's catalog; the `Emotion` enum (already in this file).
- Produces: `EMOTION_Live2DWitchExpressionName_value: Record<Emotion, string | undefined>` — consumed by Task 4 (`Stage.vue`).

- [ ] **Step 1: Add the map.** Append to `packages/stage-ui/src/constants/emotions.ts`, mirroring `EMOTION_VRMExpressionName_value`. Replace each value with Task 1's finalized assignment (the values below are the parameter-based starting point — use the catalog's finalized column):

```ts
// neru 마녀 모델 전용 — 9개 감정을 witch exp3 표정 이름으로 매핑한다(undefined = 표정 없음/중립).
// 값은 M-E Phase 2 Part A 시각 카탈로그(neru-witch-expression-catalog.md)로 확정한다.
// 마녀는 감정 모션이 없어 exp3 표정이 유일한 감정 표면이다. 표정 미등록 모델에선 applyEmotion이 no-op.
export const EMOTION_Live2DWitchExpressionName_value = {
  [Emotion.Happy]: undefined,
  [Emotion.Sad]: 'ku',
  [Emotion.Angry]: 'sq',
  [Emotion.Think]: undefined,
  [Emotion.Surprise]: undefined,
  [Emotion.Awkward]: undefined,
  [Emotion.Question]: undefined,
  [Emotion.Curious]: undefined,
  [Emotion.Neutral]: undefined,
} satisfies Record<Emotion, string | undefined>
```

- [ ] **Step 2: Typecheck.** The `satisfies Record<Emotion, string | undefined>` fails compilation if any of the 9 emotions is missing.

Run: `pnpm -F @proj-airi/stage-ui typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit.**

```bash
git add packages/stage-ui/src/constants/emotions.ts
git commit -m "feat(stage-ui): add witch emotion->exp3 expression map"
```

---

## Task 4 (Part B): wire `applyEmotion` into `Stage.vue`

**Files:**
- Modify: `packages/stage-ui/src/components/scenes/Stage.vue`

**Interfaces:**
- Consumes: `EMOTION_Live2DWitchExpressionName_value` (Task 3), `useExpressionStore().applyEmotion` (Task 2).
- Produces: none (integration endpoint).

- [ ] **Step 1: Import the store + map.** In `Stage.vue`, add `useExpressionStore` to the existing `@proj-airi/stage-ui-live2d` import (currently `import { Live2DScene, useLive2dParams } from '@proj-airi/stage-ui-live2d'`):

```ts
import { Live2DScene, useExpressionStore, useLive2dParams } from '@proj-airi/stage-ui-live2d'
```

Add `EMOTION_Live2DWitchExpressionName_value` to the existing emotions import (currently `import { Emotion, EMOTION_EmotionMotionName_value, EMOTION_VRMExpressionName_value, EmotionThinkMotionName } from '../../constants/emotions'`):

```ts
import { Emotion, EMOTION_EmotionMotionName_value, EMOTION_Live2DWitchExpressionName_value, EMOTION_VRMExpressionName_value, EmotionThinkMotionName } from '../../constants/emotions'
```

- [ ] **Step 2: Instantiate the store.** Near the other store setups (e.g. after `const { currentMotion } = storeToRefs(useLive2dParams())`), add:

```ts
const expressionStore = useExpressionStore()
```

- [ ] **Step 3: Call `applyEmotion` in the Live2D emotion branch.** In `emotionsQueue`'s Live2D branch, keep the motion line and add the exp3 call:

```ts
      else if (stageModelRenderer.value === 'live2d') {
        currentMotion.value = { group: EMOTION_EmotionMotionName_value[ctx.data.name] }
        // 감정→exp3 표정(마녀 전용 맵; 표정 미등록 모델에선 no-op, 모션 경로는 그대로).
        expressionStore.applyEmotion(EMOTION_Live2DWitchExpressionName_value[ctx.data.name])
      }
```

- [ ] **Step 4: Typecheck + build.**

Run: `pnpm -F @proj-airi/stage-ui typecheck` (expected: exit 0). Then lint: `node node_modules/eslint/bin/eslint.js packages/stage-ui/src/components/scenes/Stage.vue packages/stage-ui/src/constants/emotions.ts` from `airi` root (expected: no errors).

- [ ] **Step 5: Commit.**

```bash
git add packages/stage-ui/src/components/scenes/Stage.vue
git commit -m "feat(stage-ui): drive witch expressions from emotions in the Live2D branch"
```

---

## Notes for the executor

- Tasks 2 → 3 → 4 are ordered: Task 4 consumes both. Task 1 (catalog) must finalize before Task 3's map values (Task 2 is independent of Task 1 and may run first).
- After all tasks: dispatch the final whole-branch code review. Then STOP — do NOT open a PR or merge (human merges), and do NOT start the next milestone (M-G). Leave a completion summary in `.superpowers/sdd/progress.md`.
- Manual visual confirmation of emotion→expression on the running app is a human step after merge; note it as a follow-up rather than blocking the branch.
