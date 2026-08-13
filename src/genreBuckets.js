// 친구랑 할 게임을 성격별로 묶는다.
//
// 왜: 41개를 한 줄로 늘어놓으면 "뭘 고르지"가 다시 시작된다.
// "오늘 셋이서 가볍게"와 "주말에 각 잡고"는 봐야 할 곳이 다르다.
//
// 근거는 **Steam 유저 태그**다. Steam `genres` 는 너무 거칠어서
// (Risk of Rain 2 의 장르는 "Action, Indie" 가 전부다) 성격을 못 가른다.
// 태그는 사람들이 직접 붙인 거라 "Action Roguelike", "Open World",
// "Board Game" 처럼 우리가 원하는 결을 그대로 담고 있다.
//
// SteamSpy 는 태그를 **득표순**으로 준다. 앞에 올수록 그 게임을 잘 설명하므로
// 순위를 가중치로 쓴다 — 어떤 태그가 "있다/없다"보다 "얼마나 대표적이냐"가 중요하다.

const BUCKETS = [
  'coopStory',   // 협동 스토리
  'party',       // 파티 · 캐주얼
  'roguelike',   // 로그라이크 · 반복 플레이
  'survival',    // 생존 · 건설
  'shooter',     // 슈팅 · 경쟁
  'strategy',    // 전략 · 보드게임
  'openworld',   // 오픈월드 · 액션
  'etc',         // 그 외
];

// 버킷별 태그 사전. 값은 그 태그가 버킷을 얼마나 확정짓는지(배수).
// 3 = 이 태그 하나로 성격이 정해짐 / 1 = 거들 뿐
const TAG_WEIGHTS = {
  strategy: {
    'board game': 3, 'turn-based strategy': 3, 'grand strategy': 3, '4x': 3,
    'deckbuilding': 3, 'card game': 2, 'real-time strategy': 3, 'rts': 3,
    'turn-based tactics': 2, 'strategy': 2, 'tactical': 1, 'city builder': 2,
  },
  roguelike: {
    'roguelike': 3, 'rogue-like': 3, 'rogue-lite': 3, 'roguelite': 3,
    'action roguelike': 3, 'roguelike deckbuilder': 3, 'roguevania': 3,
    'bullet heaven': 2, 'replay value': 1, 'procedural generation': 1, 'permadeath': 1,
  },
  shooter: {
    'battle royale': 3, 'fps': 3, 'shooter': 2, 'third-person shooter': 2,
    'hero shooter': 3, 'arena shooter': 3, 'looter shooter': 2, 'moba': 3,
    'pvp': 1, 'competitive': 2, 'esports': 2, 'tactical shooter': 3,
  },
  survival: {
    'survival': 3, 'open world survival craft': 3, 'base building': 3,
    'crafting': 2, 'colony sim': 3, 'building': 1, 'sandbox': 1, 'farming sim': 2,
  },
  party: {
    'party game': 3, '4 player local': 3, 'local multiplayer': 2,
    'local co-op': 2, 'split screen': 1, 'funny': 1, 'casual': 1, 'family friendly': 1,
  },
  openworld: {
    'open world': 3, 'exploration': 1, 'action-adventure': 1, 'sandbox': 1,
    'automobile sim': 1, 'racing': 2, 'rpg': 1, 'souls-like': 2,
  },
  coopStory: {
    'story rich': 3, 'puzzle': 2, 'co-op campaign': 3, 'narrative': 2,
    'adventure': 1, 'online co-op': 1, 'co-op': 1, 'split screen': 1, 'atmospheric': 1,
  },
};

// 동점일 때의 우선순위 — 성격이 더 뾰족한 쪽이 이긴다
const TIE_BREAK = ['strategy', 'roguelike', 'shooter', 'survival', 'party', 'openworld', 'coopStory'];

/**
 * 태그 순위를 가중치로. 1등 태그가 가장 세고 뒤로 갈수록 약해진다.
 * (SteamSpy 는 득표순으로 준다)
 */
function rankWeight(index, total) {
  return (total - index) / total; // 1위 → 1.0, 꼴찌 → 1/total
}

/**
 * @param {object} g { tags: string[], genres?: string[], categories?: string[] }
 * @returns {string} BUCKETS 중 하나
 */
function bucketOf(g) {
  const tags = (g.tags || []).map((x) => String(x).toLowerCase());

  if (tags.length) {
    const score = {};
    for (const b of TIE_BREAK) score[b] = 0;
    tags.forEach((tag, i) => {
      const w = rankWeight(i, tags.length);
      for (const b of TIE_BREAK) {
        const mult = TAG_WEIGHTS[b][tag];
        if (mult) score[b] += mult * w;
      }
    });
    let best = null;
    for (const b of TIE_BREAK) {
      if (score[b] <= 0) continue;
      if (!best || score[b] > score[best]) best = b;
    }
    if (best) return best;
  }

  // 태그가 아직 없는 게임(수집 전)은 장르로만 최소 분류한다
  const genres = g.genres || [];
  const cats = g.categories || [];
  const hasG = (re) => genres.some((x) => re.test(x));
  const hasC = (re) => cats.some((x) => re.test(x));
  if (hasG(/Strategy/i)) return 'strategy';
  if (hasC(/Co-?op/i) && hasG(/Adventure/i)) return 'coopStory';
  if (hasG(/Casual/i)) return 'party';
  if (hasC(/PvP/i)) return 'shooter';
  if (hasC(/Co-?op/i)) return 'coopStory';
  return 'etc';
}

/** 게임 목록을 버킷 순서대로 묶는다. 빈 버킷은 뺀다. */
function groupByBucket(games) {
  const map = new Map(BUCKETS.map((b) => [b, []]));
  for (const g of games) map.get(bucketOf(g) || 'etc').push(g);
  return BUCKETS
    .map((key) => ({ key, games: map.get(key) }))
    .filter((x) => x.games.length);
}

module.exports = { bucketOf, groupByBucket, BUCKETS, TAG_WEIGHTS };
