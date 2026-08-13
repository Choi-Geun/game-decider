// 뽑기 루프 — 카드 3장 뽑기 + 판정.
//
// 갱신 정책은 "상태 기준": 고른 도전을 깨야 다음 3장이 나온다.
// 달력 기준(매일 만료)을 쓰지 않는 이유 — 게임 세션은 매일이 아니다.
// 만료가 잦으면 그게 곧 "안 했네" 신호가 되고, 여가 도구에서 죄책감은 재미의 반대다.
// 대신 깨지 않고 새로 뽑는 것만 하루 1번으로 묶는다. 무한 리롤이면 마음에 들 때까지
// 돌리게 되고, 그건 기존 슬롯머신이 가진 바로 그 문제다.

const { classifyLibrary } = require('./gameState');
const { pickNextAchievement, lastUnlockedAchievement } = require('./resume');
const { tierOf } = require('./collection');

// 각 슬롯에서 상위 몇 개까지를 후보로 볼지. 1등만 뽑으면 하루 만에 질린다.
const CANDIDATE_POOL = 12;
const LEGEND_MAX = 5; // 전설 기준 (globalPercent)

const SLOTS = ['legend', 'comeback', 'light'];

/**
 * 하루 경계를 오전 6시로 둔다. 새벽 2시까지 하는 건 아직 "오늘"이다.
 * 서버 로컬 시간 기준 — 전 세계 배포 시엔 유저 타임존을 받아야 한다(현재는 미지원).
 */
function dayKey(now, boundaryHour = 6) {
  const d = new Date((now - boundaryHour * 3600) * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const lockedOf = (game) =>
  ((game.ach && game.ach.achievements) || []).filter((a) => !a.achieved && a.globalPercent != null);

/** 상위 pool 개 중 하나를 무작위로 */
function sample(list, rng, pool = CANDIDATE_POOL) {
  if (!list.length) return null;
  const n = Math.min(pool, list.length);
  return list[Math.floor(rng() * n)];
}

// ── 슬롯별 후보 ───────────────────────────────────────────────────

// 가볍게 — 페이스를 아는 게임 중 빠른 순. "몇 분이면 하나" 라고 말할 수 있는 것들
function lightCandidates(classified) {
  return classified
    .filter((c) => c.signals.unlockPaceMinutes != null && lockedOf(c.game).length)
    .sort((a, b) => a.signals.unlockPaceMinutes - b.signals.unlockPaceMinutes);
}

// 돌아가기 — 중도이탈 중 가장 최근에 멈춘 순. 재진입 비용이 가장 낮다
function comebackCandidates(classified) {
  return classified
    .filter((c) => c.state === '중도이탈' && c.signals.lastUnlock && lockedOf(c.game).length)
    .sort((a, b) => b.signals.lastUnlock - a.signals.lastUnlock);
}

// 한 방 — 전설이 남은 게임. 많이 해둔 게임 우선(맥락이 남아 있는 쪽이 실제로 한다)
function legendCandidates(classified) {
  return classified
    .filter((c) => lockedOf(c.game).some((a) => a.globalPercent < LEGEND_MAX))
    .sort((a, b) => b.signals.playtimeMinutes - a.signals.playtimeMinutes);
}

// ── 목표 도전과제 선정 ────────────────────────────────────────────

function targetFor(slot, game) {
  const locked = lockedOf(game);
  if (!locked.length) return null;
  if (slot === 'legend') {
    // 전설 중 가장 흔한 것. 가장 어려운 걸 들이밀면 목표가 아니라 벽이다
    const legends = locked.filter((a) => a.globalPercent < LEGEND_MAX);
    if (!legends.length) return null;
    return legends.reduce((best, a) => (a.globalPercent > best.globalPercent ? a : best));
  }
  const last = lastUnlockedAchievement((game.ach && game.ach.achievements) || []);
  return pickNextAchievement(game.ach.achievements, last ? last.globalPercent : null);
}

function toCard(slot, entry) {
  const { game, signals } = entry;
  const target = targetFor(slot, game);
  if (!target) return null;
  return {
    slot,
    appid: game.appid,
    gameName: game.name,
    images: game.images || null,
    apiname: target.apiname,
    achName: target.name,
    achDesc: target.description || '',
    globalPercent: target.globalPercent,
    tier: tierOf(target.globalPercent),
    // 표시용 근거 — 왜 이 카드가 이 슬롯에 있는지 설명할 수 있어야 한다
    paceMinutes: signals.unlockPaceMinutes,
    dormantDays: signals.dormantDays,
    playtimeMinutes: signals.playtimeMinutes,
    completionPct: signals.completionPct,
  };
}

/**
 * 카드 3장. 축이 다른 3장이어야 선택이 의미가 있다.
 * 같은 게임이 두 번 나오지 않게 뽑은 것을 제외해 가며 진행한다.
 * 후보가 없는 슬롯은 남은 후보 아무거나로 메운다 — 라이브러리가 작으면 슬롯이 빌 수 있다.
 */
function drawCards(cache, opts = {}) {
  const now = opts.now || Math.floor(Date.now() / 1000);
  const rng = opts.rng || Math.random;
  const classified = classifyLibrary(cache.games || [], now).filter(
    (c) => c.state !== '무한형' && c.state !== '완주' && lockedOf(c.game).length
  );

  const pools = {
    legend: legendCandidates(classified),
    comeback: comebackCandidates(classified),
    light: lightCandidates(classified),
  };

  const used = new Set();
  const cards = [];

  for (const slot of SLOTS) {
    const avail = pools[slot].filter((c) => !used.has(c.game.appid));
    const chosen = sample(avail, rng);
    if (!chosen) continue;
    const card = toCard(slot, chosen);
    if (!card) continue;
    used.add(chosen.game.appid);
    cards.push(card);
  }

  // 빈 슬롯 메우기 — 3장을 채울 수 있으면 채운다
  if (cards.length < SLOTS.length) {
    const rest = classified.filter((c) => !used.has(c.game.appid));
    for (const entry of rest) {
      if (cards.length >= SLOTS.length) break;
      // 어떤 슬롯 성격으로도 설명 가능한 순서로 시도
      const card = toCard('light', entry) || toCard('legend', entry);
      if (!card) continue;
      used.add(entry.game.appid);
      cards.push(card);
    }
  }

  return cards;
}

/**
 * 판정.
 *
 * 성공 = 그 도전과제가 achieved 이고, unlockTime 이 고른 시각 이후.
 * unlockTime 조건이 필요한 이유: 캐시가 낡아서 "미달성처럼 보이던" 것을 뽑았을 수 있다.
 * 그걸 성공으로 세면 판정이 거짓이 된다.
 *
 * 아직 안 깼으면 pending — 실패라는 상태는 만들지 않는다.
 * 반영이 안 됐을 수도 있으므로 절대 자동 실패 처리하지 않는다.
 */
function checkPick(picked, cache) {
  if (!picked) return { status: 'none' };
  const game = (cache.games || []).find((g) => String(g.appid) === String(picked.appid));
  if (!game) return { status: 'pending', reason: 'game-missing' };
  const a = ((game.ach && game.ach.achievements) || []).find((x) => x.apiname === picked.apiname);
  if (!a) return { status: 'pending', reason: 'achievement-missing' };
  if (!a.achieved) return { status: 'pending' };
  // 뽑을 때 잠겨 있던 것만 카드가 되므로 achieved 자체가 강한 증거다.
  // unlockTime 이 아예 없는 경우(전체의 0.1% 미만)는 시점을 확인할 방법이 없어 인정한다 —
  // 영원히 pending 으로 묶어두는 쪽이 더 나쁘다.
  if (!a.unlockTime) return { status: 'done', unlockTime: null };
  if (a.unlockTime >= picked.pickedAt) return { status: 'done', unlockTime: a.unlockTime };
  return { status: 'pending', reason: 'unlocked-before-pick' };
}

/**
 * 상태를 한 걸음 진행시킨다. API가 읽을 때마다 호출한다.
 * 별도 잡이 필요 없다 — 동기화는 이미 로그인 시·20분마다·탭 복귀 시 자동으로 돈다.
 *
 * @returns {{ state, justCompleted }} justCompleted 는 이번 호출에서 확정된 성공(연출용, 1회성)
 */
function advance(state, cache, opts = {}) {
  const now = opts.now || Math.floor(Date.now() / 1000);
  const rng = opts.rng || Math.random;
  let next = { ...state };
  let justCompleted = null;

  const cur = next.current;
  if (cur && cur.picked) {
    const card = cur.cards[cur.picked.index];
    const verdict = checkPick({ ...card, pickedAt: cur.picked.pickedAt }, cache);
    if (verdict.status === 'done') {
      justCompleted = {
        ...card,
        pickedAt: cur.picked.pickedAt,
        unlockTime: verdict.unlockTime,
        status: 'done',
      };
      next.history = [justCompleted, ...(next.history || [])];
      next.stats = { ...next.stats, done: (next.stats.done || 0) + 1 };
      next.current = null; // 깼으니 다음 장
    }
  }

  if (!next.current) {
    next.current = {
      drawnAt: now,
      cards: drawCards(cache, { now, rng }),
      picked: null,
      rerollUsedOn: (state.current && state.current.rerollUsedOn) || null,
    };
  }

  return { state: next, justCompleted };
}

/** 선택 확정 */
function pick(state, index, now) {
  const cur = state.current;
  if (!cur || !cur.cards[index]) return { ok: false, error: 'no-such-card' };
  if (cur.picked) return { ok: false, error: 'already-picked' };
  return {
    ok: true,
    state: { ...state, current: { ...cur, picked: { index, pickedAt: now } } },
  };
}

/** 새로 3장. 하루 1번, 선택 전에만. */
function reroll(state, cache, opts = {}) {
  const now = opts.now || Math.floor(Date.now() / 1000);
  const rng = opts.rng || Math.random;
  const cur = state.current;
  if (!cur) return { ok: false, error: 'no-draw' };
  if (cur.picked) return { ok: false, error: 'already-picked' };
  const today = dayKey(now);
  if (cur.rerollUsedOn === today) return { ok: false, error: 'no-rerolls-left' };
  return {
    ok: true,
    state: {
      ...state,
      current: { drawnAt: now, cards: drawCards(cache, { now, rng }), picked: null, rerollUsedOn: today },
    },
  };
}

/**
 * 포기 — 고른 걸 접고 새로 뽑는다. 재뽑기 1회를 소비한다.
 * 히스토리에는 조용히 남기고 UI에는 보여주지 않는다. 실패는 상태로 만들지 않는다.
 */
function giveUp(state, cache, opts = {}) {
  const now = opts.now || Math.floor(Date.now() / 1000);
  const rng = opts.rng || Math.random;
  const cur = state.current;
  if (!cur || !cur.picked) return { ok: false, error: 'nothing-picked' };
  const today = dayKey(now);
  if (cur.rerollUsedOn === today) return { ok: false, error: 'no-rerolls-left' };
  const card = cur.cards[cur.picked.index];
  return {
    ok: true,
    state: {
      ...state,
      history: [{ ...card, pickedAt: cur.picked.pickedAt, status: 'gave_up' }, ...(state.history || [])],
      current: { drawnAt: now, cards: drawCards(cache, { now, rng }), picked: null, rerollUsedOn: today },
    },
  };
}

/** 오늘 재뽑기가 남았는지 */
function rerollAvailable(state, now) {
  const cur = state.current;
  if (!cur) return true;
  return cur.rerollUsedOn !== dayKey(now);
}

module.exports = {
  drawCards, checkPick, advance, pick, reroll, giveUp, rerollAvailable, dayKey,
  _constants: { CANDIDATE_POOL, LEGEND_MAX, SLOTS },
};
