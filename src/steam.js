// 설치된 Steam 게임 목록을 읽어온다.
// - 윈도우(게이밍 PC): 실제 Steam 설치 폴더를 파싱해서 진짜 게임 목록을 만든다.
// - 그 외(맥/개발용): mock/games.json 의 가짜 목록을 돌려준다.
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── 아주 단순한 VDF 파서 ──────────────────────────────────────────
// Steam의 .vdf/.acf 파일은 "key" "value" 형태. 정규식으로 쌍을 다 긁는다.
function parseVdfPairs(text) {
  const pairs = [];
  const re = /"([^"]+)"\s+"([^"]*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    pairs.push([m[1], m[2]]);
  }
  return pairs;
}

// 윈도우에서 Steam 기본 설치 후보 경로들
function windowsSteamRoots() {
  const candidates = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
  ];
  return candidates.filter((p) => fs.existsSync(p));
}

// libraryfolders.vdf 를 읽어 모든 라이브러리 경로(다른 드라이브 포함)를 찾는다.
function findLibraryPaths(steamRoot) {
  const libs = new Set([steamRoot]);
  const vdf = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
  try {
    const text = fs.readFileSync(vdf, 'utf8');
    for (const [key, val] of parseVdfPairs(text)) {
      if (key === 'path' && val) libs.add(val.replace(/\\\\/g, '\\'));
    }
  } catch (_e) {}
  return [...libs];
}

// 한 라이브러리 폴더 안의 appmanifest_*.acf 들을 읽어 게임 목록으로.
function readGamesFromLibrary(libPath) {
  const appsDir = path.join(libPath, 'steamapps');
  const games = [];
  let files = [];
  try {
    files = fs.readdirSync(appsDir).filter((f) => /^appmanifest_\d+\.acf$/.test(f));
  } catch (_e) {
    return games;
  }
  for (const file of files) {
    try {
      const text = fs.readFileSync(path.join(appsDir, file), 'utf8');
      const map = Object.fromEntries(parseVdfPairs(text));
      const appid = map.appid;
      const name = map.name;
      if (!appid || !name) continue;
      games.push({
        appid: String(appid),
        name,
        sizeOnDisk: Number(map.SizeOnDisk || 0),
        lastUpdated: Number(map.LastUpdated || 0),
        // 플레이타임/장르는 이 파일엔 없음 → 나중에 store API·localconfig 로 보강.
        playtimeMinutes: null,
        genres: [],
        tags: [],
      });
    } catch (_e) {}
  }
  return games;
}

// 윈도우 실제 게임 목록
function getWindowsGames() {
  const roots = windowsSteamRoots();
  const all = [];
  const seen = new Set();
  for (const root of roots) {
    for (const lib of findLibraryPaths(root)) {
      for (const g of readGamesFromLibrary(lib)) {
        if (seen.has(g.appid)) continue;
        seen.add(g.appid);
        all.push(g);
      }
    }
  }
  return all;
}

// 개발용 mock 목록
function getMockGames() {
  const p = path.join(__dirname, '..', 'mock', 'games.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_e) {
    return [];
  }
}

async function getInstalledGames() {
  if (os.platform() === 'win32') {
    const real = getWindowsGames();
    // 혹시 못 찾으면 개발이 막히지 않게 mock 으로 폴백
    return real.length ? real : getMockGames();
  }
  return getMockGames();
}

module.exports = { getInstalledGames, parseVdfPairs };
