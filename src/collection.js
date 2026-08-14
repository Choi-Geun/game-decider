// 수집함 — 이미 딴 것 중 희귀한 것들의 진열장.
//
// 왜 "받을 보상"이 아니라 "해낸 것"에 등급을 매기나:
// 실측(본인 87개)에서 미달성 도전과제 4,990개 중 76%가 20% 미만이었다.
// 내가 안 깬 건 남들도 안 깬 것이므로 남은 것에 등급을 붙이면 전부 "희귀"가 되어
// 의미가 없다. 반대로 이미 딴 1,199개 중 5% 미만은 17개(1.4%)뿐 —
// 여기서는 등급이 실제로 희소하다. 그래서 수집함에서만 절대 희귀도를 쓴다.
//
// (뽑기·미션의 난이도는 절대 희귀도가 아니라 내 진도 기준 상대치로 매긴다. resume.js 참고)

const DAY = 86400;

// 전역 달성률 기준. 낮을수록 희귀하다.
const TIERS = [
  { key: 'legendary', max: 5 },
  { key: 'rare', max: 20 },
  { key: 'normal', max: 50 },
  { key: 'common', max: Infinity },
];

function tierOf(globalPercent) {
  if (globalPercent == null) return null;
  return TIERS.find((t) => globalPercent < t.max).key;
}

// 게임의 도전과제를 게임 정보와 함께 펼친다.
function flatten(games, filterFn) {
  const out = [];
  for (const game of games || []) {
    const list = (game.ach && game.ach.achievements) || [];
    for (const a of list) {
      if (a.globalPercent == null) continue;
      if (!filterFn(a)) continue;
      out.push({
        apiname: a.apiname,
        name: a.name,
        description: a.description,
        globalPercent: a.globalPercent,
        unlockTime: a.unlockTime || null,
        tier: tierOf(a.globalPercent),
        appid: game.appid,
        gameName: game.name,
        images: game.images || null,
      });
    }
  }
  return out;
}

const byRarest = (a, b) => a.globalPercent - b.globalPercent;

/**
 * 게임별 수집 현황.
 *
 * 가장 희귀한 하나만 보여주면 "이게 뭐지?"가 된다. 내 라이브러리 전체가 어떤
 * 상태인지 같이 보여야 그 하나가 어디에 놓인 건지 이해된다.
 * 전설을 많이 가진 게임이 앞으로 — 그 게임이 곧 내 수집의 본진이다.
 */
function byGame(games) {
  return (games || [])
    .map((game) => {
      const list = (game.ach && game.ach.achievements) || [];
      const counts = { legendary: 0, rare: 0, normal: 0, common: 0, total: 0 };
      for (const a of list) {
        if (!a.achieved || a.globalPercent == null) continue;
        counts[tierOf(a.globalPercent)]++;
        counts.total++;
      }
      const pick = (arr, n) => arr.slice(0, n).map((a) => ({
        apiname: a.apiname, name: a.name, description: a.description,
        globalPercent: a.globalPercent, tier: tierOf(a.globalPercent), unlockTime: a.unlockTime || null,
      }));
      const withPct = list.filter((a) => a.globalPercent != null);
      // 딴 것 중 희귀한 순 — 그 게임에서 자랑할 만한 것
      const done = withPct.filter((a) => a.achieved).sort((x, y) => x.globalPercent - y.globalPercent);
      // 남은 것 중 흔한 순 — 그 게임에서 다음에 손댈 만한 것
      const left = withPct.filter((a) => !a.achieved).sort((x, y) => y.globalPercent - x.globalPercent);
      return {
        appid: game.appid,
        name: game.name,
        images: game.images || null,
        counts,
        unlocked: (game.ach && game.ach.unlocked) || 0,
        total: (game.ach && game.ach.total) || 0,
        completionPct: (game.ach && game.ach.completionPct) || 0,
        remaining: left.length,
        top: pick(done, 4),
        nextUp: pick(left, 4),
      };
    })
    .filter((g) => g.counts.total > 0)
    .sort((a, b) => {
      if (b.counts.legendary !== a.counts.legendary) return b.counts.legendary - a.counts.legendary;
      if (b.counts.rare !== a.counts.rare) return b.counts.rare - a.counts.rare;
      return b.counts.total - a.counts.total;
    });
}

/**
 * "다음 한 개" 후보 — 남은 것 중 가장 손에 닿는 희귀 도전과제.
 *
 * 희귀한 것 중에서도 **가장 흔한 것**을 고른다. 가장 어려운 걸 들이밀면 목표가 아니라
 * 벽이다. 같은 조건이면 이미 많이 해본 게임을 우선 — 맥락이 남아 있는 쪽이 실제로 한다.
 */
function nextTargets(games, tierKey, limit = 3) {
  const ceiling = TIERS.find((t) => t.key === tierKey).max;
  return flatten(games, (a) => !a.achieved && a.globalPercent < ceiling)
    .map((a) => {
      const g = games.find((x) => x.appid === a.appid);
      return { ...a, playtimeMinutes: (g && g.playtimeMinutes) || 0 };
    })
    .sort((a, b) => {
      if (b.globalPercent !== a.globalPercent) return b.globalPercent - a.globalPercent;
      return b.playtimeMinutes - a.playtimeMinutes;
    })
    .slice(0, limit);
}

/**
 * @param {object} cache cache.js 구조
 * @param {object} opts  { now, displayLimit, harvestDays }
 */
function buildCollection(cache, opts = {}) {
  const now = opts.now || Math.floor(Date.now() / 1000);
  const displayLimit = opts.displayLimit || 24;
  // 달력 월을 쓰면 월초에 무조건 0개라 화면이 빈다. 최근 N일이 항상 뭔가 보여준다.
  const harvestDays = opts.harvestDays || 30;
  const games = cache.games || [];

  const gameRows = byGame(games);
  const unlocked = flatten(games, (a) => a.achieved).sort(byRarest);

  const counts = { legendary: 0, rare: 0, normal: 0, common: 0, total: unlocked.length };
  for (const a of unlocked) counts[a.tier]++;

  // 진열은 희귀한 것부터. 가장 희귀한 하나가 주인공이 된다.
  const showcase = unlocked.filter((a) => a.tier === 'legendary' || a.tier === 'rare').slice(0, displayLimit);

  const since = now - harvestDays * DAY;
  const harvest = unlocked
    .filter((a) => a.unlockTime && a.unlockTime >= since)
    .sort((a, b) => b.unlockTime - a.unlockTime);

  return {
    counts,
    // 가장 희귀한 하나 — 헤드라인
    crown: unlocked[0] || null,
    showcase,
    // 게임별 현황 — 내 수집이 어디에 몰려 있는지
    games: gameRows,
    // 완주가 눈앞인 게임
    almostDone: almostDone(gameRows),
    // 다음 전설 후보. 수집함이 앞으로 향하게 하는 유일한 장치
    nextTargets: nextTargets(games, 'legendary', 3),
    harvest: {
      days: harvestDays,
      count: harvest.length,
      rarest: harvest.length ? harvest.reduce((m, a) => (a.globalPercent < m.globalPercent ? a : m)) : null,
      items: harvest.slice(0, 12),
    },
  };
}

/**
 * 완주에 가까운 게임. 절대 임계값(85% 이상 같은)으로 끊으면 라이브러리에 따라
 * 통째로 비어버리므로(실측: 본인 87개 중 '3개 이하 남음' 0개) 상대 순위로 뽑는다.
 */
function almostDone(gameRows, limit = 6) {
  return gameRows
    .filter((g) => g.remaining > 0 && g.total > 3)
    .sort((a, b) => b.completionPct - a.completionPct || a.remaining - b.remaining)
    .slice(0, limit);
}

module.exports = { buildCollection, tierOf, TIERS, nextTargets, byGame, almostDone };
