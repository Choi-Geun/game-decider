// Electron 메인 프로세스 — 창을 만들고, 화면(renderer)이 요청하는 일들을 처리한다.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { getInstalledGames } = require('./src/steam');
const { recommend } = require('./src/recommend');
const { recommendPlus } = require('./src/recommendPlus');
const { loadEnv } = require('./src/env');
const steamAuth = require('./src/steamAuth');
const cacheStore = require('./src/cache');

// .env 파일에서 API 키 등 설정을 읽어온다 (없어도 앱은 돈다).
const env = loadEnv(path.join(__dirname, '.env'));

// 회사망(SSL 검사) 등에서 self-signed 인증서 오류가 나면 INSECURE_TLS=1 로 우회.
// ※ 개발용 임시 조치. 배포 빌드에선 쓰지 말 것.
if (env.INSECURE_TLS === '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// 로그인/캐시 상태 (메모리)
let session = { steamId: null, cache: null };
let mainWin = null;

function createWindow() {
  mainWin = new BrowserWindow({
    width: 480,
    height: 760,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWin.loadFile('index.html');
  // 개발 중엔 개발자도구를 열어두면 편하다. 배포 땐 이 줄을 지운다.
  // mainWin.webContents.openDevTools();
}

// ── 화면(renderer) → 메인 으로 오는 요청 처리 ──────────────────────

// 1) 설치된 게임 목록 달라
ipcMain.handle('get-games', async () => {
  return getInstalledGames();
});

// 2) 조건(기분/시간/인원) 받아서 1개 골라줘
ipcMain.handle('recommend', async (_evt, input) => {
  const games = await getInstalledGames();
  return recommend(games, input, env);
});

// 3) 이 게임 실행해줘 (Steam 프로토콜)
ipcMain.handle('launch-game', async (_evt, appid) => {
  await shell.openExternal(`steam://run/${appid}`);
  return true;
});

// ── v0.2: Steam 연동 ─────────────────────────────────────────────

// 4) Steam 로그인 (OpenID) → SteamID 획득. 캐시가 있으면 바로 로드.
ipcMain.handle('steam-login', async () => {
  const steamId = await steamAuth.login();
  session.steamId = steamId;
  const cached = cacheStore.loadCache(app.getPath('userData'), steamId);
  if (cached) session.cache = cached;
  return { steamId, profile: cached?.profile || null, hasCache: !!cached, updatedAt: cached?.updatedAt || null };
});

// 5) 전체 라이브러리 도전과제 동기화(캐싱). 진행률은 이벤트로 화면에 보냄.
ipcMain.handle('steam-sync', async () => {
  const apiKey = env.STEAM_API_KEY;
  if (!apiKey) return { ok: false, error: 'STEAM_API_KEY 없음 (.env 설정 필요)' };
  if (!session.steamId) return { ok: false, error: '먼저 로그인하세요' };
  try {
    const data = await cacheStore.buildFullCache(
      apiKey,
      session.steamId,
      app.getPath('userData'),
      (done, total, name) => {
        if (mainWin && !mainWin.isDestroyed())
          mainWin.webContents.send('sync-progress', { done, total, name });
      }
    );
    session.cache = data;
    return { ok: true, count: data.games.length, updatedAt: data.updatedAt };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

// 6) 현재 로그인/캐시 상태
ipcMain.handle('steam-status', async () => ({
  steamId: session.steamId,
  profile: session.cache?.profile || null,
  hasCache: !!session.cache,
  count: session.cache?.games?.length || 0,
  updatedAt: session.cache?.updatedAt || null,
}));

// 7) 도전과제/이어하기 기반 추천
ipcMain.handle('recommend-plus', async (_evt, mode) => {
  if (!session.cache) return { mode, game: null, reason: '먼저 로그인 후 동기화하세요.', nextAchievements: [] };
  return recommendPlus(session.cache, mode);
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
