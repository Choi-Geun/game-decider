// 친구 기반 코옵 추천.
// 내 라이브러리 ∩ 친구 라이브러리 → 코옵/멀티 게임만 → 보유 친구 + 접속상태 매칭.
const fs = require('fs');
const path = require('path');
const api = require('./steamApi');
const { groupByBucket } = require('./genreBuckets');

// SteamSpy 태그 캐시. 한 번에 다 받으면 첫 로딩이 너무 길어져서
// 요청당 상한을 두고 회차를 나눠 채운다 — 그 전에도 장르만으로 분류는 된다.
const TAG_FETCH_PER_REQUEST = 15;
const TAG_FETCH_DELAY_MS = 1000; // SteamSpy 는 초당 1회 권장

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 게임 카테고리(코옵/멀티) 캐시 — 정적이라 한 번 받으면 계속 재사용.
function catFile(dir) {
  return path.join(dir, 'categories.json');
}
function tagFile(dir) {
  return path.join(dir, 'tags.json');
}
function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_e) { return fallback; }
}
function saveJson(p, obj) {
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); } catch (_e) {}
}
function loadCats(dir) {
  try {
    return JSON.parse(fs.readFileSync(catFile(dir), 'utf8'));
  } catch (_e) {
    return {};
  }
}
function saveCats(dir, obj) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(catFile(dir), JSON.stringify(obj, null, 2));
  } catch (_e) {}
}

// myGames: [{ appid, name }] (내 캐시의 게임들)
// onProgress(done, total, name) — 카테고리 조회 단계 진행률
async function buildFriendCoop(apiKey, steamId, myGames, dir, onProgress) {
  const nameByApp = {};
  const myAppIds = new Set();
  for (const g of myGames || []) {
    myAppIds.add(String(g.appid));
    nameByApp[String(g.appid)] = g.name;
  }

  // 1) 친구 목록
  const friends = await api.getFriendList(apiKey, steamId);
  if (!friends.length) {
    return { friendCount: 0, publicFriends: 0, privateFriendList: true, games: [] };
  }
  const friendIds = friends.map((f) => f.steamid);

  // 2) 친구 프로필(이름/아바타/접속상태/현재게임)
  const summaries = await api.getPlayerSummaries(apiKey, friendIds);
  const profById = {};
  for (const s of summaries) profById[s.steamid] = s;

  // 3) 각 친구 보유게임 → 나와 겹치는 appid 수집
  const ownersByApp = {}; // appid -> Set(friendSteamId)
  let publicFriends = 0;
  for (const fid of friendIds) {
    let games = [];
    try {
      games = await api.getOwnedGames(apiKey, fid);
    } catch (_e) {
      games = [];
    }
    if (games.length) publicFriends += 1;
    for (const g of games) {
      const appid = String(g.appid);
      if (myAppIds.has(appid)) {
        (ownersByApp[appid] = ownersByApp[appid] || new Set()).add(fid);
      }
    }
    await sleep(80);
  }

  const candidateApps = Object.keys(ownersByApp);

  // 4) 겹치는 게임만 코옵/멀티 분류 (캐시 우선)
  const cats = loadCats(dir);
  let done = 0;
  // genres 가 없는 옛 캐시는 다시 받는다 (장르 필드를 나중에 추가했다)
  const needsCat = (a) => !cats[a] || !Array.isArray(cats[a].genres);
  const toClassify = candidateApps.filter(needsCat);
  for (const appid of candidateApps) {
    if (needsCat(appid)) {
      cats[appid] = await api.getAppCategories(appid);
      done += 1;
      if (onProgress) onProgress(done, toClassify.length, nameByApp[appid] || appid);
      await sleep(250); // store API 레이트리밋 완화
    }
  }
  saveCats(dir, cats);

  // 4-b) 성격 분류용 태그 — 캐시에 없는 것만 상한까지 채운다
  const tagPath = tagFile(dir);
  const tagMap = loadJson(tagPath, {});
  const coopApps = candidateApps.filter((a) => cats[a] && (cats[a].coop || cats[a].multiplayer));
  const missingTags = coopApps.filter((a) => !Array.isArray(tagMap[a]));
  for (const appid of missingTags.slice(0, TAG_FETCH_PER_REQUEST)) {
    tagMap[appid] = await api.getSteamSpyTags(appid);
    await sleep(TAG_FETCH_DELAY_MS);
  }
  if (missingTags.length) saveJson(tagPath, tagMap);

  // 5) 코옵/멀티 게임만 결과로. 각 게임에 보유 친구 + 접속상태.
  const games = [];
  for (const appid of candidateApps) {
    const cat = cats[appid] || {};
    if (!cat.coop && !cat.multiplayer) continue;
    const owners = [...ownersByApp[appid]].map((fid) => {
      const p = profById[fid] || {};
      return {
        steamid: fid,
        name: p.name || fid,
        avatar: p.avatar || null,
        online: !!p.online,
        inGameName: p.inGameName || null,
        playingThis: p.inGameId === appid,
      };
    });
    owners.sort((a, b) => Number(b.playingThis) - Number(a.playingThis) || Number(b.online) - Number(a.online));
    games.push({
      appid,
      name: nameByApp[appid] || appid,
      images: api.imageUrls(appid),
      coop: !!cat.coop,
      multiplayer: !!cat.multiplayer,
      ownerCount: owners.length,
      onlineCount: owners.filter((o) => o.online).length,
      owners,
      genres: cat.genres || [],
      categories: cat.categories || [],
      tags: tagMap[appid] || [],
    });
  }

  // 6) 정렬: 접속 친구 있는 것 → 친구 수 많은 것 → 코옵 우선
  games.sort(
    (a, b) =>
      b.onlineCount - a.onlineCount ||
      b.ownerCount - a.ownerCount ||
      Number(b.coop) - Number(a.coop)
  );

  // 7) 성격별로 묶는다. 41개를 한 줄로 늘어놓으면 "뭘 고르지"가 다시 시작된다.
  const groups = groupByBucket(games);
  const tagsPending = Math.max(0, missingTags.length - TAG_FETCH_PER_REQUEST);

  return { friendCount: friends.length, publicFriends, privateFriendList: false, games, groups, tagsPending };
}

module.exports = { buildFriendCoop };
