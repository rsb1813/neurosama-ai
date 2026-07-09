// neru 오버레이 프리로드 — 렌더러에 안전한 클릭통과 토글만 노출(contextIsolation 유지)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("neruOverlay", {
  setClickThrough: (enabled) => ipcRenderer.send("neru:set-click-through", Boolean(enabled)),
});
