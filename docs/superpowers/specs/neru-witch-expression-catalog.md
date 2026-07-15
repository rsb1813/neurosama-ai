<!-- neru 마녀 모델 표정 12개 확정 카탈로그 — 라이브 스테이지 모델에 각 exp3를 적용해 capturePage로 시각 확인(2026-07-15). Phase 2 감정→표정 매핑의 확정 입력. -->
# neru Witch — Expression Catalog (confirmed)

**Status:** CONFIRMED — each of the 12 `.exp3.json` was applied to the live stage
model and captured via `capturePage` (Phase 2 Part A harness, 2026-07-15). The
"Visual" column below is from those screenshots.

## How the catalog was built

The 12 exp3 do register in the **stage window's** expression store (runtime-
verified: `registerExpressions groups=12`). The settings panel is a separate,
empty BrowserWindow (see `.superpowers/sdd/progress.md`), so the catalog was NOT
built from the panel — a temporary harness cycled each expression on the live
model and the main process captured a PNG per expression. The harness was reverted
after capture.

## The 12 expressions (confirmed visuals)

Key finding: only **7** are facial/emotional; **5** are **prop/costume toggles**
(they add an object or change the outfit) and are intentionally excluded from the
emotion map — spawning a gamepad or removing the hat on an emotion would be
jarring.

| exp Name | Parameters | Visual (confirmed) | Kind | Emotion |
|----------|------------|--------------------|------|---------|
| `x`  | Param59=0, Param60=30 | **heart-shaped pupils** (pink/blue), loving | facial | **happy** |
| `xx` | Param59=30, Param60=0 | **star-shaped pupils** (yellow), sparkling wonder | facial | **surprised / curious** |
| `sq` | Param67=30, angry brow (ParamBrowLForm=-0.879, ParamBrowLY=-0.727) | angled/lowered brows, half-lidded displeased look | facial | **angry** |
| `ku` | Param68=30, distressed brow (ParamBrowLForm=+1, ParamBrowLY=-0.788) | soft gentle face, faintly worried brow | facial | **sad** (best available) |
| `h`  | Param69=30 | **pink blush** on cheeks, shy downward glance | facial | **awkward** |
| `yj` | Param66=30 | **round glasses** appear, studious/inquisitive | facial | **think / question** |
| `hdj`| Param65=30 | **shadow cast over the eyes/forehead** — sinister / malicious, a disgust-or-contempt "evil smug" look (user-confirmed) | facial | _(unused — no matching AIRI emotion; reserve for a future "evil/smug" beat or manual trigger)_ |
| `zs1`| Param61=30, Param62=0 | holds a **game controller** (gamepad) | prop | — (excluded) |
| `zs2`| Param61=0, Param62=30 | holds a **black microphone** | prop | — (excluded) |
| `cw` | Param64=30 | cute **ghost companions** float around | prop/fx | — (excluded) |
| `fz` | Param72=30 | holds a glowing **magic staff** with blue flame | prop | — (excluded) |
| `mz` | Param71=30 | **witch hat removed**, hair down | costume | — (excluded) |

## Finalized emotion → exp3 map (for `EMOTION_Live2DWitchExpressionName_value`)

9 AIRI emotions → witch exp3 name (or `undefined` = neutral/relaxed). Only facial
expressions are used; adjacent emotions may reuse the same expression when no
distinct one exists (harmless — `applyEmotion` just activates that group).

| Emotion | exp3 | rationale |
|---------|------|-----------|
| `happy` | `x` | heart eyes = joy/love |
| `sad` | `ku` | soft, faintly worried — the only sad-leaning face |
| `angry` | `sq` | angled angry brows |
| `think` | `yj` | glasses = studious/thinking |
| `surprised` | `xx` | star/sparkle eyes = amazement |
| `awkward` | `h` | blush = embarrassed/shy |
| `question` | `yj` | glasses = inquisitive (reuses think) |
| `curious` | `xx` | sparkle eyes = interest (reuses surprised) |
| `neutral` | `undefined` | relax to neutral (reset) |

The 5 prop/costume expressions (`zs1`, `zs2`, `cw`, `fz`, `mz`) are left out of the
emotion map. They remain registered and can still be driven manually / by future
LLM expression tools if desired (out of scope here).
