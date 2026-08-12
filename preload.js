// preload — 화면(renderer)에서 안전하게 쓸 수 있는 window.api 를 노출한다.
// 화면 코드는 Node를 직접 못 만지고, 여기 정의된 함수들만 쓸 수 있다(보안).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getGames: () => ipcRenderer.invoke('get-games'),
  recommend: (input) => ipcRenderer.invoke('recommend', input),
  launchGame: (appid) => ipcRenderer.invoke('launch-game', appid),

  // v0.2: Steam 연동
  steamLogin: () => ipcRenderer.invoke('steam-login'),
  steamSync: () => ipcRenderer.invoke('steam-sync'),
  steamStatus: () => ipcRenderer.invoke('steam-status'),
  recommendPlus: (mode) => ipcRenderer.invoke('recommend-plus', mode),
  onSyncProgress: (cb) => ipcRenderer.on('sync-progress', (_e, data) => cb(data)),
});
