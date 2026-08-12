// 로컬 캐시 — 보유 게임 + 도전과제를 JSON 파일로 저장/로드.
// 전체 라이브러리 도전과제를 백그라운드로 긁어 캐싱한다(결정: 전체 미리 캐싱).
const fs = require('fs');
const path = require('path');
const api = require('./steamApi');

// 캐시 파일 위치 (앱 데이터 폴더). main 에서 app.getPath('userData') 를 넘겨준다.
function cacheFile(userDataDir, steamId) {
  return path.join(userDataDir, `cache_${steamId}.json`);
}

function loadCache(userDataDir, steamId) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(userDataDir, steamId), 'utf8'));
  } catch (_e) {
    return null;
  }
}

function saveCache(userDataDir, steamId, data) {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(cacheFile(userDataDir, steamId), JSON.stringify(data, null, 2));
  } catch (_e) {}
}

// 잠깐 쉬기 (레이트리밋 완화)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 게임 1개의 도전과제 블록을 API로 새로 조회.
async function fetchAchBlock(apiKey, steamId, appid) {
  const [mine, global] = await Promise.all([
    api.getPlayerAchievements(apiKey, steamId, appid),
    api.getGlobalAchievementPercents(appid),
  ]);
  let total = 0;
  let unlocked = 0;
  const achievements = mine.achievements.map((a) => {
    total += 1;
    if (a.achieved) unlocked += 1;
    return { ...a, globalPercent: global[a.apiname] ?? null };
  });
  return {
    hasAchievements: mine.hasAchievements,
    private: !!mine.private,
    total,
    unlocked,
    completionPct: total ? Math.round((unlocked / total) * 100) : null,
    achievements,
  };
}

// 이 게임의 도전과제를 다시 긁어야 하는지 판단 (증분 동기화 핵심).
function needsRefetch(cur, old) {
  if (!old || !old.ach) return true; // 새 게임 or 캐시에 도전과제 없음
  if (old.ach.private) return true; // 이전에 비공개로 막혔으면 재시도 (설정 바꿨을 수 있음)
  // 플레이타임이 늘었으면 = 플레이했음 = 도전과제 바뀌었을 수 있음
  if ((cur.playtimeMinutes || 0) > (old.playtimeMinutes || 0)) return true;
  // 마지막 플레이 시각이 갱신됐으면
  if ((cur.lastPlayed || 0) > (old.lastPlayed || 0)) return true;
  return false;
}

// 동기화 (증분 or 전체).
//  opts.full=true → 전체 재조회, 아니면 캐시와 비교해 바뀐 게임만.
//  onProgress(done, total, name) 로 진행률(=실제로 조회하는 게임 수 기준).
// 반환: { ...data, _stats: { fetched, reused, added, removed } }
async function syncCache(apiKey, steamId, dir, opts = {}) {
  const { onProgress, full = false } = opts;
  const old = full ? null : loadCache(dir, steamId);
  const oldByApp = {};
  if (old && old.games) for (const g of old.games) oldByApp[g.appid] = g;

  const summary = await api.getPlayerSummary(apiKey, steamId);
  const current = await api.getOwnedGames(apiKey, steamId);

  // 조회가 필요한 게임만 추림
  const toFetch = current.filter((g) => needsRefetch(g, oldByApp[g.appid]));
  const stats = { fetched: 0, reused: 0, added: 0, removed: 0 };
  stats.added = current.filter((g) => !oldByApp[g.appid]).length;
  const curIds = new Set(current.map((g) => g.appid));
  stats.removed = old && old.games ? old.games.filter((g) => !curIds.has(g.appid)).length : 0;

  const achByApp = {};
  let done = 0;
  let privateCount = 0;
  for (const g of current) {
    if (needsRefetch(g, oldByApp[g.appid])) {
      achByApp[g.appid] = await fetchAchBlock(apiKey, steamId, g.appid);
      stats.fetched += 1;
      done += 1;
      if (onProgress) onProgress(done, toFetch.length, g.name);
      await sleep(120);
    } else {
      // 바뀐 게 없으면 기존 도전과제 재사용 (API 호출 안 함)
      achByApp[g.appid] = oldByApp[g.appid].ach;
      stats.reused += 1;
    }
    if (achByApp[g.appid] && achByApp[g.appid].private) privateCount += 1;
  }

  const achievementsBlocked = current.length > 0 && privateCount >= Math.ceil(current.length * 0.5);

  const data = {
    steamId,
    profile: summary ? { name: summary.personaname, avatar: summary.avatarfull } : old?.profile || null,
    updatedAt: Math.floor(Date.now() / 1000),
    achievementsBlocked,
    privateCount,
    // 각 게임에 Steam 이미지 URL을 함께 캐싱 (appid로 계산, 저장공간 부담 없음)
    games: current.map((g) => ({ ...g, images: api.imageUrls(g.appid), ach: achByApp[g.appid] })),
  };
  saveCache(dir, steamId, data);
  data._stats = stats;
  return data;
}

// 전체 동기화 (하위호환 — Electron main.js 등에서 사용)
async function buildFullCache(apiKey, steamId, dir, onProgress) {
  return syncCache(apiKey, steamId, dir, { onProgress, full: true });
}

module.exports = { loadCache, saveCache, buildFullCache, syncCache, needsRefetch };
