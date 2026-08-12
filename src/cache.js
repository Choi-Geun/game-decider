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

// 전체 라이브러리 도전과제 수집.
// onProgress(done, total, gameName) 로 진행률을 알려준다.
async function buildFullCache(apiKey, steamId, userDataDir, onProgress) {
  const summary = await api.getPlayerSummary(apiKey, steamId);
  const games = await api.getOwnedGames(apiKey, steamId);

  const byApp = {};
  let done = 0;
  let privateCount = 0;
  for (const g of games) {
    const [mine, global] = await Promise.all([
      api.getPlayerAchievements(apiKey, steamId, g.appid),
      api.getGlobalAchievementPercents(g.appid),
    ]);
    if (mine.private) privateCount += 1;
    let total = 0;
    let unlocked = 0;
    const achievements = mine.achievements.map((a) => {
      total += 1;
      if (a.achieved) unlocked += 1;
      return { ...a, globalPercent: global[a.apiname] ?? null };
    });
    byApp[g.appid] = {
      hasAchievements: mine.hasAchievements,
      private: !!mine.private,
      total,
      unlocked,
      completionPct: total ? Math.round((unlocked / total) * 100) : null,
      achievements,
    };
    done += 1;
    if (onProgress) onProgress(done, games.length, g.name);
    await sleep(120); // 게임 사이 살짝 텀 (레이트리밋)
  }

  // 절반 이상이 403(비공개)이면 "게임 세부정보 비공개"로 판단.
  const achievementsBlocked = games.length > 0 && privateCount >= Math.ceil(games.length * 0.5);

  const data = {
    steamId,
    profile: summary ? { name: summary.personaname, avatar: summary.avatarfull } : null,
    updatedAt: Math.floor(Date.now() / 1000),
    achievementsBlocked,
    privateCount,
    games: games.map((g) => ({ ...g, ach: byApp[g.appid] })),
  };
  saveCache(userDataDir, steamId, data);
  return data;
}

module.exports = { loadCache, saveCache, buildFullCache };
