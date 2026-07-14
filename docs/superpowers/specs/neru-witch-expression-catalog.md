<!-- neru 마녀 모델 표정 12개 예비 카탈로그(파라미터 기반) — Phase 2 감정→표정 매핑의 시작 입력. 시각 확인은 Phase 2에서 표정 등록을 고친 뒤 채운다. -->
# neru Witch — Expression Catalog (preliminary, Phase 2 input)

**Status:** PRELIMINARY — derived from each `.exp3.json`'s parameters, NOT yet
visually confirmed. The visual "Description" column must be filled in Phase 2
once expression registration works (see below).

## Why not visually confirmed yet

Phase 1 verified the witch renders with working blink/gaze/lip-sync. But AIRI's
Live2D **expression** settings panel shows "No expressions available for this
model" — the witch's 12 `.exp3.json` groups do not register in
`useExpressionStore`, so they can't be previewed via the UI. This is an AIRI
expression-system issue (silent early-return in
`Model.vue:initExpressionController`; no fetch error), independent of the model
packaging (Task 1 validated all 12 exp3 refs resolve in the zip). It is Phase 2's
job to fix — Phase 2 (emotion→exp3 wiring) requires expression registration to
work anyway. Diagnosis lives in `.superpowers/sdd/progress.md` (Task 4 section).

## What the parameters tell us

Each expression sets one custom rig parameter (`Param59`–`Param72`) to 30, except
two that also move the brow — the only interpretable emotional hints today. Names
are opaque pinyin abbreviations.

| exp Name | Parameters set | Param-based hint | Candidate emotion | Visual (Phase 2) |
|----------|----------------|------------------|-------------------|------------------|
| `sq` | Param67=30, ParamBrowLForm=-0.879, ParamBrowLY=-0.727 | angry-shaped brow (down + angled) | **angry** (likely) | _tbd_ |
| `ku` | Param68=30, ParamBrowLForm=+1, ParamBrowLY=-0.788 | distressed brow (down, rounded) | **sad** (likely) | _tbd_ |
| `x`  | Param59=0, Param60=30 | one of a Param59/60 pair | smile/happy? | _tbd_ |
| `xx` | Param59=30, Param60=0 | inverse of `x` | smile variant? | _tbd_ |
| `zs1`| Param61=30, Param62=0 | one of a Param61/62 pair | ? | _tbd_ |
| `zs2`| Param61=0, Param62=30 | inverse of `zs1` | ? | _tbd_ |
| `cw` | Param64=30 | single custom param | ? | _tbd_ |
| `fz` | Param72=30 | single custom param | ? | _tbd_ |
| `h`  | Param69=30 | single custom param | ? | _tbd_ |
| `hdj`| Param65=30 | single custom param | ? | _tbd_ |
| `mz` | Param71=30 | single custom param | ? | _tbd_ |
| `yj` | Param66=30 | single custom param | ? | _tbd_ |

## For Phase 2

1. Fix expression registration (see progress ledger's suspects: `settings.expressions`
   vs the zip loader's `_expFiles`; the `live2dExpressionEnabled`-at-load race; OPFS cache).
   Consider seeding `settings/live2d/expression-enabled = true` in `neruPreseed.ts`.
2. With expressions previewable, fill the "Visual" column by toggling each in the
   model-settings UI.
3. Map AIRI's 9 emotions (happy, sad, angry, think, surprised, awkward, question,
   curious, neutral) → a subset of these 12 exp3 names, and build the emotion→exp3
   glue (does not exist in AIRI — Live2D emotions currently map to motion groups only).
