// Steam Web API 클라이언트.
// 필요한 것: API 키(.env STEAM_API_KEY) + 대상 SteamID64 + 공개 프로필.
const https = require('https');

const HOST = 'api.steampowered.com';
const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps';

// appid로 계산되는 Steam 이미지 URL 모음 (키·인증 불필요).
function imageUrls(appid) {
  const base = `${CDN}/${appid}`;
  return {
    header: `${base}/header.jpg`, // 460x215 배너
    capsule: `${base}/capsule_616x353.jpg`, // 616x353
    portrait: `${base}/library_600x900.jpg`, // 세로 포스터
    hero: `${base}/library_hero.jpg`, // 넓은 배경
    logo: `${base}/logo.png`, // 투명 로고
  };
}

// 공통 GET (JSON) — 회사망 SSL 검사 환경에서도 개발되게, 실패 시 명확한 에러.
function getJson(path, host = HOST) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: host, path, method: 'GET', headers: { accept: 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`Steam API ${res.statusCode}: ${path.split('?')[0]}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Steam API 응답 파싱 실패'));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Steam API 타임아웃')));
    req.end();
  });
}

// 프로필 요약 (이름/아바타)
async function getPlayerSummary(apiKey, steamId) {
  const path = `/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId}`;
  const j = await getJson(path);
  return j.response?.players?.[0] || null;
}

// 보유 게임 목록 (+플레이타임/마지막 플레이)
async function getOwnedGames(apiKey, steamId) {
  const path =
    `/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}` +
    `&include_appinfo=1&include_played_free_games=1&format=json`;
  const j = await getJson(path);
  const games = j.response?.games || [];
  return games.map((g) => ({
    appid: String(g.appid),
    name: g.name,
    playtimeMinutes: g.playtime_forever || 0,
    playtime2weeks: g.playtime_2weeks || 0,
    lastPlayed: g.rtime_last_played || 0, // unix seconds
    iconUrl: g.img_icon_url
      ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg`
      : null,
  }));
}

// 특정 게임의 내 도전과제 달성 여부.
// 도전과제 없는 게임/비공개면 { hasAchievements:false } 로 조용히 넘어감.
async function getPlayerAchievements(apiKey, steamId, appid, lang = 'korean') {
  const path =
    `/ISteamUserStats/GetPlayerAchievements/v1/?key=${apiKey}&steamid=${steamId}` +
    `&appid=${appid}&l=${lang}`;
  try {
    const j = await getJson(path);
    const stats = j.playerstats;
    if (!stats || stats.success === false || !stats.achievements) {
      return { appid: String(appid), hasAchievements: false, achievements: [] };
    }
    const achievements = stats.achievements.map((a) => ({
      apiname: a.apiname,
      achieved: a.achieved === 1,
      unlockTime: a.unlocktime || 0,
      name: a.name || a.apiname,
      description: a.description || '',
    }));
    return { appid: String(appid), hasAchievements: true, private: false, achievements };
  } catch (e) {
    // 403 "Profile is not public" → 도전과제가 없는 게 아니라 프라이버시로 막힌 것.
    const isPrivate = /403/.test(String(e && e.message));
    return { appid: String(appid), hasAchievements: false, private: isPrivate, achievements: [] };
  }
}

// 도전과제 전역 희귀도(%) — 키 불필요. 높을수록 흔함(=쉬움).
async function getGlobalAchievementPercents(appid) {
  const path = `/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}&format=json`;
  try {
    const j = await getJson(path);
    const list = j.achievementpercentages?.achievements || [];
    const map = {};
    for (const a of list) map[a.name] = Number(a.percent);
    return map; // { apiname: percent }
  } catch (_e) {
    return {};
  }
}

// 친구 목록 (친구 목록이 공개여야 함). [{ steamid, friend_since }]
async function getFriendList(apiKey, steamId) {
  const path = `/ISteamUser/GetFriendList/v1/?key=${apiKey}&steamid=${steamId}&relationship=friend`;
  try {
    const j = await getJson(path);
    return j.friendslist?.friends || [];
  } catch (_e) {
    return []; // 401(비공개) 등 → 빈 목록
  }
}

// 여러 SteamID의 프로필 요약 (최대 100개). 온라인 상태/현재 게임 포함.
async function getPlayerSummaries(apiKey, steamIds) {
  if (!steamIds || !steamIds.length) return [];
  const ids = steamIds.slice(0, 100).join(',');
  const path = `/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${ids}`;
  const j = await getJson(path);
  return (j.response?.players || []).map((p) => ({
    steamid: p.steamid,
    name: p.personaname,
    avatar: p.avatarfull || p.avatar,
    // personastate: 0 오프라인, 1 온라인, 2 바쁨, 3 자리비움, 4 잠깐, 5/6 거래/플레이희망
    online: (p.personastate || 0) > 0,
    personastate: p.personastate || 0,
    // 지금 게임 중이면 gameid/gameextrainfo 존재
    inGameId: p.gameid ? String(p.gameid) : null,
    inGameName: p.gameextrainfo || null,
  }));
}

// 게임의 카테고리(코옵/멀티 여부) — store appdetails (비공식). 키 불필요.
async function getAppCategories(appid) {
  const path = `/api/appdetails?appids=${appid}&filters=categories`;
  try {
    const j = await getJson(path, 'store.steampowered.com');
    const entry = j[String(appid)];
    if (!entry || !entry.success) return { coop: false, multiplayer: false };
    const cats = (entry.data?.categories || []).map((c) => (c.description || '').toLowerCase());
    const has = (kw) => cats.some((c) => c.includes(kw));
    const coop = has('co-op') || has('co op') || has('coop');
    const multiplayer = has('multi-player') || has('multiplayer') || has('pvp') || has('online');
    return { coop, multiplayer: multiplayer || coop };
  } catch (_e) {
    return { coop: false, multiplayer: false };
  }
}

module.exports = {
  getPlayerSummary,
  getPlayerSummaries,
  getOwnedGames,
  getPlayerAchievements,
  getGlobalAchievementPercents,
  getFriendList,
  getAppCategories,
  imageUrls,
};
