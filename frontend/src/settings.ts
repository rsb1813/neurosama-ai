// neru 아바타 설정 상태 관리 + AIRI 스타일 설정 패널 UI (localStorage 영속)

// 오버레이 프리로드가 노출하는 클릭통과 토글(없으면 브라우저 단독 실행 중).
declare global {
  interface Window {
    neruOverlay?: { setClickThrough(enabled: boolean): void };
  }
}

// 설정 스키마 — 아바타 배치·움직임·오버레이 동작을 한곳에 모은다.
export interface NeruSettings {
  scale: number; // 모델 높이 배율(화면 높이 대비, 0.4~1.3)
  offsetX: number; // 중앙 기준 가로 오프셋(px)
  offsetY: number; // 하단 기준 세로 오프셋(px, 양수면 위로)
  lookAt: boolean; // 커서 시선추적
  idleMotion: boolean; // 아이들 모션 자동 재생
  expression: string; // 강제 표정("" = 없음/기본)
  clickThrough: boolean; // 오버레이 클릭 통과(데스크톱 조작 방해 안 함)
  mouthTest: boolean; // 입 사인파 테스트(립싱크 배선 전 확인용)
}

const STORAGE_KEY = "neru.settings.v1";

const DEFAULTS: NeruSettings = {
  scale: 0.9,
  offsetX: 0,
  offsetY: 0,
  lookAt: true,
  idleMotion: true,
  expression: "",
  clickThrough: false,
  mouthTest: false,
};

// 저장된 설정을 기본값과 병합해 로드(스키마 확장 시 안전).
export function loadSettings(): NeruSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<NeruSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(s: NeruSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // 저장 실패는 무시(시크릿 모드 등) — 세션 내 동작엔 지장 없음.
  }
}

// 설정 변경을 구독자에게 알리는 얇은 컨트롤러.
export class SettingsStore {
  private state: NeruSettings;
  private listeners = new Set<(s: NeruSettings) => void>();

  constructor() {
    this.state = loadSettings();
  }

  get(): NeruSettings {
    return this.state;
  }

  // 부분 갱신 → 저장 → 구독자 통지.
  set(patch: Partial<NeruSettings>): void {
    this.state = { ...this.state, ...patch };
    saveSettings(this.state);
    for (const fn of this.listeners) fn(this.state);
  }

  subscribe(fn: (s: NeruSettings) => void): void {
    this.listeners.add(fn);
    fn(this.state); // 즉시 1회 적용
  }
}

// 표정 목록은 모델마다 다르므로 주입받는다.
export interface PanelOptions {
  expressions: string[];
}

// 설정 패널 DOM을 생성하고 스토어와 양방향 바인딩한다. 톱니 버튼으로 토글.
export function mountSettingsPanel(store: SettingsStore, opts: PanelOptions): void {
  const s = store.get();

  const gear = document.createElement("button");
  gear.className = "neru-gear";
  gear.textContent = "⚙";
  gear.title = "설정";

  const panel = document.createElement("div");
  panel.className = "neru-panel neru-hidden";

  // 컨트롤 헬퍼 — 라벨 + 입력을 한 줄로.
  const row = (labelText: string, input: HTMLElement): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = "neru-row";
    const span = document.createElement("span");
    span.textContent = labelText;
    wrap.append(span, input);
    return wrap;
  };

  const slider = (
    min: number,
    max: number,
    step: number,
    value: number,
    onInput: (v: number) => void,
  ): HTMLInputElement => {
    const el = document.createElement("input");
    el.type = "range";
    el.min = String(min);
    el.max = String(max);
    el.step = String(step);
    el.value = String(value);
    el.addEventListener("input", () => onInput(Number(el.value)));
    return el;
  };

  const toggle = (value: boolean, onChange: (v: boolean) => void): HTMLInputElement => {
    const el = document.createElement("input");
    el.type = "checkbox";
    el.checked = value;
    el.addEventListener("change", () => onChange(el.checked));
    return el;
  };

  const title = document.createElement("div");
  title.className = "neru-title";
  title.textContent = "neru";

  const exprSelect = document.createElement("select");
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "(기본)";
  exprSelect.append(noneOpt);
  for (const name of opts.expressions) {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = name;
    exprSelect.append(o);
  }
  exprSelect.value = s.expression;
  exprSelect.addEventListener("change", () => store.set({ expression: exprSelect.value }));

  panel.append(
    title,
    row("크기", slider(0.4, 1.3, 0.01, s.scale, (v) => store.set({ scale: v }))),
    row("가로", slider(-300, 300, 1, s.offsetX, (v) => store.set({ offsetX: v }))),
    row("세로", slider(-300, 300, 1, s.offsetY, (v) => store.set({ offsetY: v }))),
    row("시선추적", toggle(s.lookAt, (v) => store.set({ lookAt: v }))),
    row("아이들 모션", toggle(s.idleMotion, (v) => store.set({ idleMotion: v }))),
    row("표정", exprSelect),
    row("클릭 통과", toggle(s.clickThrough, (v) => store.set({ clickThrough: v }))),
    row("입 테스트", toggle(s.mouthTest, (v) => store.set({ mouthTest: v }))),
  );

  gear.addEventListener("click", () => panel.classList.toggle("neru-hidden"));

  document.body.append(gear, panel);
}
