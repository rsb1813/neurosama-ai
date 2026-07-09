// neru 웹 프론트 — Live2D 아바타 렌더 + AIRI 스타일 움직임(시선추적·아이들·표정) + 설정 연동
import "./style.css";
import * as PIXI from "pixi.js";
import { Live2DModel, MotionPriority } from "pixi-live2d-display/cubism4";
import { SettingsStore, mountSettingsPanel, type NeruSettings } from "./settings";

// pixi-live2d-display가 window.PIXI에서 Ticker/Loader 등을 참조하므로 노출한다.
(window as any).PIXI = PIXI;

const MODEL_URL = encodeURI("/models/neru-witch/魔女.model3.json");
const MOUTH_PARAM = "ParamMouthOpenY";
const IDLE_GROUP = "idle"; // 모델 model3.json의 모션 그룹명

async function main(): Promise<void> {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;

  // 화질: HiDPI 디스플레이의 backing store 해상도를 devicePixelRatio에 맞춰 올린다.
  // autoDensity가 CSS 크기는 유지하면서 실제 픽셀만 키워 Live2D 뿌옇게 나오는 문제를 없앤다.
  const app = new PIXI.Application({
    view: canvas,
    resizeTo: window,
    backgroundAlpha: 0,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    powerPreference: "high-performance",
  });

  const model = await Live2DModel.from(MODEL_URL);
  app.stage.addChild(model);

  // 표정 목록 추출(설정 패널 드롭다운용).
  const expressionManager = model.internalModel.motionManager.expressionManager;
  const expressions: string[] =
    expressionManager?.definitions.map((d) => d.Name).filter((n): n is string => !!n) ?? [];

  // coreModel은 pixi-live2d-display 타입상 object라 파라미터 API를 캐스팅해 쓴다.
  const core = model.internalModel.coreModel as {
    setParameterValueById(id: string, value: number): void;
  };

  const store = new SettingsStore();

  // 설정을 아바타 배치에 반영(크기·오프셋). resize/설정변경마다 호출.
  const applyLayout = (): void => {
    const s = store.get();
    model.anchor.set(0.5, 1);
    const scale = (window.innerHeight * s.scale) / model.internalModel.height;
    model.scale.set(scale);
    model.x = window.innerWidth / 2 + s.offsetX;
    model.y = window.innerHeight + s.offsetY;
  };

  // 아이들 모션을 원샷으로 재생(끝나면 MotionManager가 idle 그룹을 자동 재큐잉).
  const playIdle = (): void => {
    void model.internalModel.motionManager.startRandomMotion(IDLE_GROUP, MotionPriority.IDLE);
  };

  // 설정 변경 반응: 배치·시선추적·표정·클릭통과를 즉시 적용.
  let prev: NeruSettings | null = null;
  store.subscribe((s) => {
    applyLayout();
    model.autoInteract = s.lookAt; // 라이브러리 내장 포인터 추적 on/off
    if (!s.lookAt) model.focus(0, 0); // 끄면 정면 응시로 복귀

    if (s.expression) {
      void expressionManager?.setExpression(s.expression);
    } else if (prev?.expression) {
      expressionManager?.resetExpression();
    }

    if (s.idleMotion && (!prev || !prev.idleMotion)) playIdle();

    // 오버레이 클릭 통과(preload가 있을 때만; 브라우저 단독 실행 시 무시).
    window.neruOverlay?.setClickThrough(s.clickThrough);
    prev = s;
  });

  applyLayout();
  window.addEventListener("resize", applyLayout);

  // 시선추적: autoInteract가 캔버스 포인터를 처리하지만, 오버레이에서 창 전역 커서를
  // 따라가도록 document 레벨에서도 focus를 밀어준다(AIRI처럼 화면 어디든 응시).
  window.addEventListener("pointermove", (e) => {
    if (store.get().lookAt) model.focus(e.clientX, e.clientY);
  });

  // 아이들 모션 시작(자동 눈깜빡임·호흡·머리카락 물리는 Cubism4 내부에서 자동 실행).
  if (store.get().idleMotion) playIdle();

  // 립싱크 배선(WS) 전 확인용 입 사인파 — 설정에서 켤 때만 동작.
  let t = 0;
  app.ticker.add(() => {
    if (!store.get().mouthTest) return;
    t += 0.08;
    const value = Math.sin(t) * 0.5 + 0.5; // 0..1
    core.setParameterValueById(MOUTH_PARAM, value);
  });

  mountSettingsPanel(store, { expressions });

  (window as any).__model = model; // 디버그용
  // 향후 WS 립싱크가 호출할 입 제어 훅(진폭 0..1).
  (window as any).__setMouth = (v: number): void => core.setParameterValueById(MOUTH_PARAM, v);
  console.log("[neru] model loaded", model.internalModel.width, model.internalModel.height);
}

main().catch((err) => {
  console.error("[neru] failed to load", err);
  document.body.innerHTML = `<pre style="color:#f66;padding:1rem;white-space:pre-wrap">${err}</pre>`;
});
