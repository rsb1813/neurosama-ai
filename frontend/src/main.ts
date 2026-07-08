// neru 웹 프론트 — Live2D 아바타 렌더 + 입 파라미터 검증(임시 오실레이션)
import "./style.css";
import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display/cubism4";

// pixi-live2d-display가 window.PIXI에서 Ticker/Loader 등을 참조하므로 노출한다.
(window as any).PIXI = PIXI;

const MODEL_URL = encodeURI("/models/neru-witch/魔女.model3.json");
const MOUTH_PARAM = "ParamMouthOpenY";

async function main(): Promise<void> {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const app = new PIXI.Application({
    view: canvas,
    resizeTo: window,
    backgroundAlpha: 0,
    antialias: true,
  });

  const model = await Live2DModel.from(MODEL_URL);
  app.stage.addChild(model);

  // 화면 하단 중앙 정렬 + 높이 90%에 맞춰 스케일.
  const fit = (): void => {
    model.anchor.set(0.5, 1);
    const scale = (window.innerHeight * 0.9) / model.internalModel.height;
    model.scale.set(scale);
    model.x = window.innerWidth / 2;
    model.y = window.innerHeight;
  };
  fit();
  window.addEventListener("resize", fit);

  // coreModel은 pixi-live2d-display 타입상 object라 파라미터 API를 캐스팅해 쓴다.
  const core = model.internalModel.coreModel as {
    setParameterValueById(id: string, value: number): void;
  };

  // 임시 검증: 입을 사인파로 여닫아 렌더·립싱크 파라미터가 동작하는지 확인.
  let t = 0;
  app.ticker.add(() => {
    t += 0.08;
    const value = Math.sin(t) * 0.5 + 0.5; // 0..1
    core.setParameterValueById(MOUTH_PARAM, value);
  });

  (window as any).__model = model; // 디버그용
  console.log("[neru] model loaded", model.internalModel.width, model.internalModel.height);
}

main().catch((err) => {
  console.error("[neru] failed to load", err);
  document.body.innerHTML = `<pre style="color:#f66;padding:1rem;white-space:pre-wrap">${err}</pre>`;
});
