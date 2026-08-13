// 게임 상태 판정기 — 라이브러리 기능 전부가 이 위에 얹힌다.
//
// 핵심은 도전과제의 unlockTime 이다. Steam 공개 API는 플레이 세션 이력을 주지 않지만,
// "언제 무엇을 깼는지"는 준다. 그걸로 세션 타임라인을 근사한다.
//   lastPlayed  = 게임을 실행한 마지막 시각 (런처만 켜도 갱신됨)
//   lastUnlock  = 마지막으로 뭔가를 해낸 시각  ← 이쪽이 "몰입"에 훨씬 가깝다
//
// 입력은 cache.js 가 만든 구조:
//   game = { appid, name, playtimeMinutes, playtime2weeks, lastPlayed,
//            ach: { hasAchievements, total, unlocked, completionPct,
//                   achievements: [{ apiname, achieved, unlockTime, name, description, globalPercent }] } }

const DAY = 86400;

// 도전과제가 이만큼 이하면 완주 개념이 의미 없다.
// (CS2는 도전과제가 1개라 1/1 = "100% 완주"로 잡히는데, 이건 거짓 신호다.)
const TRIVIAL_ACH_TOTAL = 3;

// 이 간격 이상 벌어지면 다른 플레이 시기로 본다.
const BURST_GAP_DAYS = 7;

// 페이스는 "한 세션에 몇 개쯤 깰까"에 답하려고 있는 값이다.
// 가끔씩 붙잡는 게임은 같은 시기 안에서도 간격이 하루 가까이 나오는데(보드게임류),
// "보통 1383분에 하나씩 깼어요" 같은 문구는 세션 계획에 아무 쓸모가 없다.
// 세션 규모를 넘으면 페이스라는 개념 자체가 성립하지 않으므로 null 로 둔다.
const MAX_MEANINGFUL_PACE_MINUTES = 240;

// 환불 시한(2시간)을 넘겼는데 방치된 것 = "찍먹"
const DABBLE_MINUTES = 120;
const DABBLE_DORMANT_DAYS = 60;

// "지금 하고 있는 것"으로 볼 최근성
const ACTIVE_DAYS = 14;

// 이어하기 후보로 볼 이탈 기간
const DORMANT_DAYS = 30;

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function hasRealAchievements(game) {
  const a = game.ach;
  return !!(a && a.hasAchievements && a.total > TRIVIAL_ACH_TOTAL);
}

// 달성 시각을 오름차순으로. unlockTime 이 없는 건(드묾) 제외한다.
function unlockTimes(game) {
  if (!game.ach || !Array.isArray(game.ach.achievements)) return [];
  return game.ach.achievements
    .filter((a) => a.achieved && a.unlockTime)
    .map((a) => a.unlockTime)
    .sort((a, b) => a - b);
}

// 연속 달성 간격을 "같은 시기 안"과 "시기 사이"로 나눈다.
function splitGaps(times) {
  const within = [];
  let bursts = times.length ? 1 : 0;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > BURST_GAP_DAYS * DAY) bursts++;
    else within.push(gap);
  }
  return { within, bursts };
}

/**
 * 게임 하나에서 파생 신호를 뽑는다. 순수 함수.
 * @param {object} game 캐시의 게임 객체
 * @param {number} now  유닉스 초 (테스트에서 고정하려고 인자로 받는다)
 */
function deriveSignals(game, now) {
  const playtimeMinutes = game.playtimeMinutes || 0;
  const hasAch = hasRealAchievements(game);
  const times = hasAch ? unlockTimes(game) : [];
  const lastUnlock = times.length ? times[times.length - 1] : null;
  const firstUnlock = times.length ? times[0] : null;
  const { within, bursts } = splitGaps(times);

  // 실제로 플레이하던 동안의 달성 간격. 시기 사이의 몇 달짜리 공백은 뺀다.
  // 이게 "이 게임에서 목표 하나에 대략 얼마 걸리나"의 유일한 개인화 근거다.
  // 표본이 적으면(간격 3개 미만) 신뢰할 수 없으므로 null.
  let unlockPaceMinutes = null;
  if (within.length >= 3) {
    // 동시 달성(간격 0)이 흔해서 중앙값이 0이 될 수 있다 → 그때는 평균으로.
    const m = median(within);
    const pace = m > 0 ? m : mean(within);
    const minutes = Math.round(pace / 60);
    if (minutes > 0 && minutes <= MAX_MEANINGFUL_PACE_MINUTES) unlockPaceMinutes = minutes;
  }

  return {
    hasAch,
    playtimeMinutes,
    playtime2weeks: game.playtime2weeks || 0,
    lastPlayed: game.lastPlayed || null,
    completionPct: hasAch ? game.ach.completionPct : null,
    total: hasAch ? game.ach.total : 0,
    unlocked: hasAch ? game.ach.unlocked : 0,
    remaining: hasAch ? game.ach.total - game.ach.unlocked : 0,
    firstUnlock,
    lastUnlock,
    // 마지막으로 "뭔가 해낸" 뒤 흐른 날. 달성이 없으면 null.
    dormantDays: lastUnlock == null ? null : Math.floor((now - lastUnlock) / DAY),
    unlockPaceMinutes,
    // 몇 번이나 돌아왔다 놨는지 = 애착 신호
    burstCount: bursts,
    unlockTimes: times,
  };
}

/**
 * 상태 하나로 분류. 앞의 조건이 우선한다.
 *
 * 무한형   완주 개념이 없는 게임 (도전과제 없거나 3개 이하)
 * 완주     100%
 * 미개봉   한 번도 실행 안 함
 * 진행중   최근 2주 플레이했거나 최근에 뭔가 깼음
 * 찍먹     2시간 미만인데 오래 방치
 * 중도이탈 의미 있게 하다가 30일 넘게 멈춤  ← 이어하기 주력 타깃
 * 잠수     그 외 (달성 이력이 없어 판단 불가한 것 등)
 */
function classify(signals) {
  if (!signals.hasAch) return '무한형';
  if (signals.completionPct === 100) return '완주';
  if (signals.playtimeMinutes === 0) return '미개봉';
  if (signals.playtime2weeks > 0) return '진행중';
  if (signals.dormantDays != null && signals.dormantDays <= ACTIVE_DAYS) return '진행중';
  if (signals.playtimeMinutes < DABBLE_MINUTES && (signals.dormantDays == null || signals.dormantDays > DABBLE_DORMANT_DAYS))
    return '찍먹';
  if (signals.dormantDays != null && signals.dormantDays > DORMANT_DAYS) return '중도이탈';
  return '잠수';
}

/**
 * 라이브러리 전체를 분류한다.
 * @returns {Array<{game, signals, state}>}
 */
function classifyLibrary(games, now = Math.floor(Date.now() / 1000)) {
  return (games || []).map((game) => {
    const signals = deriveSignals(game, now);
    return { game, signals, state: classify(signals) };
  });
}

/**
 * "완주에 가장 가까운" 게임 N개.
 *
 * 주의: 절대 임계값(85% 이상 / 5개 이하)으로 뽑으면 라이브러리에 따라 통째로 비어버린다.
 * 실측에서 본인 87개 중 "3개 이하 남음"은 0개였다. 그래서 임계값이 아니라 **상대 순위**로 뽑는다.
 * 대신 정직하려면 진행률을 같이 보여줘야 한다 — 33%짜리를 "마무리각"이라 부르면 거짓말이 된다.
 */
function closestToDone(classified, limit = 5) {
  return classified
    .filter((c) => c.state !== '무한형' && c.state !== '완주' && c.state !== '미개봉')
    .filter((c) => c.signals.completionPct != null && c.signals.remaining > 0)
    .sort((a, b) => {
      if (b.signals.completionPct !== a.signals.completionPct)
        return b.signals.completionPct - a.signals.completionPct;
      return a.signals.remaining - b.signals.remaining;
    })
    .slice(0, limit);
}

/** 상태별 개수 — 라이브러리 성향 파악용 */
function stateSummary(classified) {
  const out = {};
  for (const c of classified) out[c.state] = (out[c.state] || 0) + 1;
  return out;
}

module.exports = {
  deriveSignals,
  classify,
  classifyLibrary,
  closestToDone,
  stateSummary,
  // 테스트·튜닝용
  _constants: {
    DAY, TRIVIAL_ACH_TOTAL, BURST_GAP_DAYS, DABBLE_MINUTES, DABBLE_DORMANT_DAYS,
    ACTIVE_DAYS, DORMANT_DAYS, MAX_MEANINGFUL_PACE_MINUTES,
  },
};
