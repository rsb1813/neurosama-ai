// neru 데스크톱 오버레이 — 투명·프레임리스·항상 위 창을 화면 우하단 코너에 띄운다(AIRI 스타일)
const { app, BrowserWindow, screen, ipcMain } = require("electron");

// 렌더할 주소: 기본은 Vite 개발 서버. 빌드본을 쓰려면 NERU_OVERLAY_URL로 덮어쓴다.
const OVERLAY_URL = process.env.NERU_OVERLAY_URL || "http://localhost:5173";
const WIN_W = 400;
const WIN_H = 640;
const MARGIN = 24; // 화면 가장자리 여백

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: width - WIN_W - MARGIN,
    y: height - WIN_H - MARGIN,
    transparent: true, // 투명 배경(데스크톱 위로 아바타만 보이게)
    frame: false, // 창 테두리 없음
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: { contextIsolation: true },
  });
  // 전체화면 앱 위에도 뜨도록 최상위 레벨 지정.
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true);
  win.loadURL(OVERLAY_URL);

  // 렌더러가 요청하면 클릭 통과(데스크톱 조작 방해 안 함) on/off 토글.
  ipcMain.on("neru:set-click-through", (_e, enabled) => {
    win.setIgnoreMouseEvents(Boolean(enabled), { forward: true });
  });
  return win;
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
