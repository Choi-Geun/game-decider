// 친구랑 할 게임을 성격별로 묶는다.
//
// 왜 이렇게까지 하나: 41개를 한 줄로 늘어놓으면 "뭘 고르지"가 다시 시작된다.
// "오늘 셋이서 가볍게" 인지 "주말에 각 잡고" 인지에 따라 볼 곳이 달라야 한다.
//
// 데이터 사정:
// - Steam `genres` 는 거칠다 (Action / Adventure / Casual / Strategy …).
//   로그라이크·오픈월드·생존 같은 성격은 장르에 아예 없다.
//   (Risk of Rain 2 의 장르는 "Action, Indie" 가 전부다)
// - SteamSpy `tags` 는 그걸 잡아주지만 신뢰도가 들쭉날쭉하다.
//   실측에서 It Takes Two 가 "Life Sim, Dating Sim, Romance" 로 나왔다.
//
// → 그래서 **장르·카테고리를 기준으로 삼고 태그는 보강으로만** 쓴다.
//   장르로 확실히 판별되는 건 태그가 뭐라 하든 장르를 따른다.

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

const has = (list, re) => (list || []).some((x) => re.test(String(x)));

/**
 * @param {object} g { genres: string[], categories: string[], tags: string[] }
 * @returns {string} BUCKETS 중 하나
 */
function bucketOf(g) {
  const genres = g.genres || [];
  const cats = g.categories || [];
  const tags = g.tags || [];

  const isCoop = has(cats, /Co-?op/i);
  const isPvP = has(cats, /PvP/i);
  const isCasual = has(genres, /Casual/i);
  const isAdventure = has(genres, /Adventure/i);
  const isStrategy = has(genres, /Strategy/i);

  // Steam 은 보드게임·로그라이크에도 Casual 을 자주 붙인다. 그래서 성격이 뚜렷한
  // 태그를 파티 판정보다 먼저 본다 — 안 그러면 Gaia Project 가 '파티'로 간다.
  if (isStrategy && has(tags, /Board Game|Turn-Based/i)) return 'strategy';
  if (has(tags, /Rogue-?l(ik|it)e|Roguelite/i)) return 'roguelike';
  // 배틀로얄은 Survival 태그를 달고 있지만 성격은 경쟁이다 (PUBG 가 '생존'으로 갔었다)
  if (has(tags, /Battle Royale/i)) return 'shooter';
  if (has(tags, /Survival|Crafting|Base Building|Open World Survival/i)) return 'survival';

  // 파티 — 캐주얼한데 서로 붙는 것. 여럿이 왁자지껄한 판
  // (Overcooked / Party Animals / Goose Goose Duck)
  if (isCasual && (isPvP || has(tags, /Party/i))) return 'party';

  // 협동 스토리 — 둘이 같이 진행하는 서사물 (It Takes Two / A Way Out / We Were Here)
  // 장르가 확실하므로 SteamSpy 가 "Dating Sim" 이라 해도 무시한다
  if (isCoop && isAdventure) return 'coopStory';

  // 슈팅·경쟁 — 협동 없이 맞붙는 것
  if (has(tags, /Shooter|FPS|Battle Royale/i) || (isPvP && !isCoop)) return 'shooter';

  if (isStrategy) return 'strategy';
  if (has(tags, /Open World|Sandbox/i)) return 'openworld';

  // 태그가 아직 없는 게임(수집 전)은 장르로만 최소 분류
  if (isCoop) return 'coopStory';
  if (isCasual) return 'party';
  return 'etc';
}

/** 게임 목록을 버킷 순서대로 묶는다. 빈 버킷은 빼고. */
function groupByBucket(games) {
  const map = new Map(BUCKETS.map((b) => [b, []]));
  for (const g of games) map.get(bucketOf(g) || 'etc').push(g);
  return BUCKETS
    .map((key) => ({ key, games: map.get(key) }))
    .filter((x) => x.games.length);
}

module.exports = { bucketOf, groupByBucket, BUCKETS };
