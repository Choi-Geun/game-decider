// 도전과제/이력 기반 추천. 입력은 cache.js 가 만든 캐시 구조.
// game = { appid, name, playtimeMinutes, playtime2weeks, lastPlayed,
//          ach: { hasAchievements, total, unlocked, completionPct, achievements:[
//            { apiname, achieved, name, description, globalPercent } ] } }

// 도전과제 있는 게임만
function withAch(cache) {
  return (cache.games || []).filter((g) => g.ach && g.ach.hasAchievements && g.ach.total > 0);
}

function remainingOf(g) {
  return g.ach.achievements.filter((a) => !a.achieved);
}

// globalPercent 높을수록 흔함(=쉬움). null은 맨 뒤로.
function byEasiest(a, b) {
  const pa = a.globalPercent == null ? -1 : a.globalPercent;
  const pb = b.globalPercent == null ? -1 : b.globalPercent;
  return pb - pa;
}
function byRarest(a, b) {
  const pa = a.globalPercent == null ? 999 : a.globalPercent;
  const pb = b.globalPercent == null ? 999 : b.globalPercent;
  return pa - pb;
}

function nextAchievements(g, order, n = 3) {
  return remainingOf(g)
    .sort(order)
    .slice(0, n)
    .map((a) => ({
      name: a.name,
      description: a.description,
      globalPercent: a.globalPercent,
    }));
}

// 1) 거의 다 깬 것 마무리 (완성 50~99%)
function recommendFinish(cache) {
  const cands = withAch(cache)
    .filter((g) => g.ach.completionPct != null && g.ach.completionPct >= 50 && g.ach.completionPct < 100)
    .sort((a, b) => b.ach.completionPct - a.ach.completionPct);
  if (!cands.length) return null;
  const g = cands[0];
  return {
    mode: 'finish',
    game: g,
    reason: `이미 도전과제 ${g.ach.completionPct}% 달성 — 조금만 더 하면 100%! 마무리하기 딱 좋아요.`,
    nextAchievements: nextAchievements(g, byEasiest),
  };
}

// 2) 남은 쉬운 도전과제 (잠긴 것 중 전역 달성률 높은 게 있는 게임)
function recommendEasy(cache) {
  const scored = withAch(cache)
    .map((g) => {
      const rem = remainingOf(g).filter((a) => a.globalPercent != null);
      const easiest = rem.length ? Math.max(...rem.map((a) => a.globalPercent)) : 0;
      return { g, easiest };
    })
    .filter((x) => x.easiest >= 40) // 40% 이상이면 사실상 쉬운 편
    .sort((a, b) => b.easiest - a.easiest);
  if (!scored.length) return null;
  const g = scored[0].g;
  return {
    mode: 'easy',
    game: g,
    reason: `아직 안 딴 쉬운 도전과제가 남아 있어요 (플레이어 ${Math.round(scored[0].easiest)}%가 이미 달성). 금방 딸 수 있음.`,
    nextAchievements: nextAchievements(g, byEasiest),
  };
}

// 3) 희귀 도전과제 사냥 (잠긴 것 중 전역 달성률 매우 낮은 게 있는 게임)
function recommendRare(cache) {
  const scored = withAch(cache)
    .map((g) => {
      const rem = remainingOf(g).filter((a) => a.globalPercent != null);
      const rarest = rem.length ? Math.min(...rem.map((a) => a.globalPercent)) : 100;
      return { g, rarest };
    })
    .filter((x) => x.rarest <= 10) // 10% 이하 = 희귀
    .sort((a, b) => a.rarest - b.rarest);
  if (!scored.length) return null;
  const g = scored[0].g;
  return {
    mode: 'rare',
    game: g,
    reason: `희귀 도전과제 사냥각! 전역 달성률 ${scored[0].rarest.toFixed(1)}%짜리가 남아 있어요. 자랑거리 하나 만들기.`,
    nextAchievements: nextAchievements(g, byRarest),
  };
}

// 4) 이어하기 (최근 플레이 + 아직 안 끝낸 것). 세션 타임라인은 API에 없어서
//    lastPlayed / playtime2weeks 로 "최근" 판단.
function recommendContinue(cache) {
  const cands = withAch(cache)
    .filter((g) => g.ach.completionPct != null && g.ach.completionPct < 100)
    .filter((g) => (g.playtime2weeks || 0) > 0 || (g.lastPlayed || 0) > 0)
    .sort((a, b) => {
      // 최근 2주 플레이 우선, 그다음 마지막 플레이 시각
      if ((b.playtime2weeks || 0) !== (a.playtime2weeks || 0))
        return (b.playtime2weeks || 0) - (a.playtime2weeks || 0);
      return (b.lastPlayed || 0) - (a.lastPlayed || 0);
    });
  if (!cands.length) return null;
  const g = cands[0];
  const recent = g.playtime2weeks ? `최근 2주간 ${Math.round(g.playtime2weeks / 60)}시간 플레이` : '최근에 잡았던 게임';
  return {
    mode: 'continue',
    game: g,
    reason: `${recent} — 이어서 하기 좋아요. 도전과제 ${g.ach.completionPct}% 진행 중, 다음 목표는 아래.`,
    nextAchievements: nextAchievements(g, byEasiest),
  };
}

const MODES = {
  continue: recommendContinue,
  finish: recommendFinish,
  easy: recommendEasy,
  rare: recommendRare,
};

function recommendPlus(cache, mode = 'continue') {
  const fn = MODES[mode] || recommendContinue;
  const res = fn(cache);
  if (res) return res;
  // 해당 모드에 후보 없으면 다른 모드로 폴백
  for (const key of ['continue', 'finish', 'easy', 'rare']) {
    const alt = MODES[key](cache);
    if (alt) return alt;
  }
  return { mode, game: null, reason: '도전과제 데이터가 있는 게임을 찾지 못했어요.', nextAchievements: [] };
}

module.exports = { recommendPlus };
