// "이어하기" 카드 — 중도 이탈한 게임으로 돌아가게 만드는 것.
//
// 돌아오는 걸 막는 건 의욕이 아니라 "내가 어디까지 했더라"다.
// unlockTime 이 그걸 정확히 복원한다: 마지막으로 깬 게 뭐였고, 그게 언제였고,
// 남들은 그 다음에 뭘 깨는지.
//
// 표현 원칙: "3개월 방치"가 아니라 "3개월 전 여기서 멈췄어요".
// 사실은 같지만 감정이 다르다. 죄책감 주는 도구는 안 열게 된다.

const { classifyLibrary, stateSummary } = require('./gameState');

/**
 * 다음 목표 하나를 고른다.
 *
 * globalPercent 는 "이 도전과제를 가진 플레이어 비율"이라 높을수록 흔하다 = 대체로 초반/쉬움.
 * 내가 마지막으로 깬 것보다 흔한데 내가 없는 것 = 남들은 이미 지나간 지점 = 자연스러운 다음 단계.
 * 그중 가장 덜 흔한 것을 고르면 "바로 다음 한 칸"이 된다.
 * 해당 없으면 남은 것 중 가장 흔한 것(=가장 쉬운 것)으로 폴백.
 */
function pickNextAchievement(achievements, lastGlobalPercent) {
  const locked = achievements.filter((a) => !a.achieved && a.globalPercent != null);
  if (!locked.length) return null;

  if (lastGlobalPercent != null) {
    const ahead = locked.filter((a) => a.globalPercent > lastGlobalPercent);
    if (ahead.length) {
      return ahead.reduce((best, a) => (a.globalPercent < best.globalPercent ? a : best));
    }
  }
  return locked.reduce((best, a) => (a.globalPercent > best.globalPercent ? a : best));
}

/** 마지막으로 깬 도전과제 */
function lastUnlockedAchievement(achievements) {
  const done = achievements.filter((a) => a.achieved && a.unlockTime);
  if (!done.length) return null;
  return done.reduce((best, a) => (a.unlockTime > best.unlockTime ? a : best));
}

/**
 * 달성 시각을 0~1 위치 배열로. 진행 바에 "언제 몰입했는지"를 그리는 용도.
 * 첫 달성 ~ 마지막 달성 구간을 정규화한다.
 */
function timelinePoints(times) {
  if (times.length < 2) return [];
  const first = times[0];
  const span = times[times.length - 1] - first;
  if (span <= 0) return [];
  return times.map((t) => Math.round(((t - first) / span) * 1000) / 1000);
}

function toCard(entry) {
  const { game, signals, state } = entry;
  const achievements = game.ach.achievements || [];
  const last = lastUnlockedAchievement(achievements);
  const next = pickNextAchievement(achievements, last ? last.globalPercent : null);

  return {
    appid: game.appid,
    name: game.name,
    images: game.images || null,
    state,
    completionPct: signals.completionPct,
    unlocked: signals.unlocked,
    total: signals.total,
    remaining: signals.remaining,
    dormantDays: signals.dormantDays,
    lastUnlock: signals.lastUnlock,
    // 진행중 카드는 dormantDays 로 말하면 안 된다. 최근 2주 플레이는 있는데
    // 도전과제만 안 깬 게임이 "1326일 전"으로 보이는 사고가 난다.
    recentMinutes: signals.playtime2weeks,
    // 몇 번이나 돌아왔던 게임인지 — 애착 신호. 2 이상이면 "또 돌아온 적 있음"
    burstCount: signals.burstCount,
    unlockPaceMinutes: signals.unlockPaceMinutes,
    playtimeMinutes: signals.playtimeMinutes,
    // 실제 마지막 실행 시각. 도전과제 unlockTime 은 "깬 시각"이라 안 깨고 논 세션은 안 잡힌다.
    lastPlayed: game.lastPlayed || null,
    lastAchievement: last
      ? { name: last.name, description: last.description, globalPercent: last.globalPercent, unlockTime: last.unlockTime }
      : null,
    nextAchievement: next
      ? { name: next.name, description: next.description, globalPercent: next.globalPercent }
      : null,
    timeline: timelinePoints(signals.unlockTimes),
  };
}

/**
 * 이어하기 목록.
 *
 * 정렬은 "가장 최근에 멈춘 것" 우선 — 재진입 비용이 가장 낮기 때문.
 * (진행률이나 애착으로 정렬할 수도 있지만, 설명 가능한 기준 하나가 낫다.)
 *
 * @param {object} cache  cache.js 구조
 * @param {object} opts   { now, limit, includeActive }
 */
function buildResume(cache, opts = {}) {
  const now = opts.now || Math.floor(Date.now() / 1000);
  const limit = opts.limit || 12;
  const classified = classifyLibrary(cache.games || [], now);

  const dropped = classified
    .filter((c) => c.state === '중도이탈')
    .filter((c) => c.signals.lastUnlock != null && c.signals.remaining > 0)
    .sort((a, b) => b.signals.lastUnlock - a.signals.lastUnlock)
    .slice(0, limit)
    .map(toCard);

  // "지금 하던 것"은 따로 보여준다. 이어하기와 섞으면 둘 다 흐려진다.
  const active = opts.includeActive === false
    ? []
    : classified
        .filter((c) => c.state === '진행중' && c.signals.remaining > 0)
        .sort((a, b) => (b.signals.lastUnlock || 0) - (a.signals.lastUnlock || 0))
        .slice(0, 4)
        .map(toCard);

  return { active, dropped, summary: stateSummary(classified), droppedTotal: classified.filter((c) => c.state === '중도이탈').length };
}

module.exports = { buildResume, pickNextAchievement, lastUnlockedAchievement, timelinePoints };
