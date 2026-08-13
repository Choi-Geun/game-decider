const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { drawCards, checkPick, advance, pick, reroll, giveUp, rerollAvailable, dayKey } = require('../src/draw');
const { loadState, saveState, emptyState, HISTORY_LIMIT } = require('../src/store');

const DAY = 86400;
const NOW = 1786000000;
const ago = (d) => NOW - d * DAY;
// 항상 첫 후보를 고르는 결정적 난수 — 테스트에서 뽑기를 예측 가능하게
const firstRng = () => 0;

// specs: [globalPercent, achieved, unlockTime?]
function mkGame(appid, name, specs, over = {}) {
  const achievements = specs.map(([globalPercent, achieved, unlockTime], i) => ({
    apiname: `${appid}_A${i}`,
    name: `${name} #${i}`,
    description: '',
    achieved,
    unlockTime: achieved ? unlockTime || ago(400) : 0,
    globalPercent,
  }));
  const unlocked = achievements.filter((a) => a.achieved).length;
  return {
    appid,
    name,
    playtimeMinutes: over.playtimeMinutes != null ? over.playtimeMinutes : 600,
    playtime2weeks: over.playtime2weeks || 0,
    lastPlayed: ago(100),
    ach: {
      hasAchievements: true,
      total: achievements.length,
      unlocked,
      completionPct: Math.round((unlocked / achievements.length) * 100),
      achievements,
    },
  };
}

// 같은 시기 안에서 촘촘히 깬 이력 → unlockPace 가 잡히는 게임
function pacedGame(appid, name, dropDaysAgo) {
  const base = ago(dropDaysAgo);
  const H = 3600;
  return mkGame(appid, name, [
    [60, true, base],
    [50, true, base + H],
    [40, true, base + 2 * H],
    [30, true, base + 3 * H],
    [3, false],
    [45, false],
  ]);
}

// ── dayKey ────────────────────────────────────────────────────────

test('하루 경계는 오전 6시 — 새벽 2시는 아직 어제다', () => {
  const at = (y, m, d, h) => Math.floor(new Date(y, m - 1, d, h, 0, 0).getTime() / 1000);
  assert.equal(dayKey(at(2026, 8, 13, 2)), dayKey(at(2026, 8, 12, 23)), '새벽 2시 == 전날 밤');
  assert.notEqual(dayKey(at(2026, 8, 13, 7)), dayKey(at(2026, 8, 12, 23)), '오전 7시는 새 날');
});

// ── 뽑기 ──────────────────────────────────────────────────────────

test('축이 다른 3장이 나오고 같은 게임은 중복되지 않는다', () => {
  const cache = {
    games: [
      mkGame('1', '전설 있음', [[2, false], [4, false], [55, false], [70, true, ago(300)]], { playtimeMinutes: 9000 }),
      mkGame('2', '중도이탈', [[30, false], [40, false], [50, false], [60, true, ago(120)]]),
      pacedGame('3', '페이스 있음', 200),
    ],
  };
  const cards = drawCards(cache, { now: NOW, rng: firstRng });
  assert.equal(cards.length, 3);
  assert.equal(new Set(cards.map((c) => c.appid)).size, 3, '같은 게임이 두 번 나오면 안 된다');
  assert.deepEqual(cards.map((c) => c.slot).sort(), ['comeback', 'legend', 'light']);
});

test('전설 슬롯은 전설 중 가장 흔한 것을 고른다 — 어려운 걸 들이밀면 벽이다', () => {
  const cache = {
    games: [mkGame('1', 'A', [[0.4, false], [4.7, false], [2, false], [80, true, ago(300)]])],
  };
  const legend = drawCards(cache, { now: NOW, rng: firstRng }).find((c) => c.slot === 'legend');
  assert.equal(legend.globalPercent, 4.7);
  assert.equal(legend.tier, 'legendary');
});

test('후보가 부족하면 3장이 안 될 수 있고, 그래도 터지지 않는다', () => {
  const cache = { games: [mkGame('1', '하나뿐', [[30, false], [40, false], [50, false], [60, true, ago(200)]])] };
  const cards = drawCards(cache, { now: NOW, rng: firstRng });
  assert.ok(cards.length >= 1 && cards.length <= 3);
  assert.equal(new Set(cards.map((c) => c.appid)).size, cards.length);
});

test('도전과제 없는 라이브러리면 빈 배열 — 예외가 아니라 빈 상태', () => {
  const cache = { games: [{ appid: '1', name: 'x', playtimeMinutes: 10, ach: { hasAchievements: false, total: 0, unlocked: 0, achievements: [] } }] };
  assert.deepEqual(drawCards(cache, { now: NOW, rng: firstRng }), []);
});

test('완주한 게임과 무한형은 뽑히지 않는다', () => {
  const cache = {
    games: [
      mkGame('1', '완주', [[10, true, ago(300)], [20, true, ago(300)], [30, true, ago(300)], [40, true, ago(300)]]),
      mkGame('2', '무한형', [[10, false], [20, false]]),
    ],
  };
  assert.deepEqual(drawCards(cache, { now: NOW, rng: firstRng }), []);
});

test('카드에는 왜 이 슬롯인지 설명할 근거가 담긴다', () => {
  const cache = { games: [pacedGame('3', '페이스', 200)] };
  const card = drawCards(cache, { now: NOW, rng: firstRng })[0];
  assert.ok(card.paceMinutes > 0, '가볍게 슬롯은 페이스를 말할 수 있어야 한다');
  assert.equal(card.dormantDays, 199, '마지막 달성이 그날 새벽이라 만 199일');
  assert.ok(card.achName && card.apiname && card.gameName);
});

// ── 판정 ──────────────────────────────────────────────────────────

test('안 깼으면 pending — 실패라는 상태는 없다', () => {
  const cache = { games: [mkGame('1', 'A', [[30, false]])] };
  const r = checkPick({ appid: '1', apiname: '1_A0', pickedAt: ago(1) }, cache);
  assert.equal(r.status, 'pending');
});

test('고른 뒤에 깼으면 성공', () => {
  const cache = { games: [mkGame('1', 'A', [[30, true, NOW - 100]])] };
  const r = checkPick({ appid: '1', apiname: '1_A0', pickedAt: NOW - 500 }, cache);
  assert.equal(r.status, 'done');
  assert.equal(r.unlockTime, NOW - 100);
});

test('고르기 전에 이미 깬 것이면 성공으로 세지 않는다 — 낡은 캐시로 뽑혔을 수 있다', () => {
  const cache = { games: [mkGame('1', 'A', [[30, true, NOW - 9999]])] };
  const r = checkPick({ appid: '1', apiname: '1_A0', pickedAt: NOW - 500 }, cache);
  assert.equal(r.status, 'pending');
  assert.equal(r.reason, 'unlocked-before-pick');
});

test('unlockTime 이 없는 달성은 인정한다 — 영원히 pending 이 더 나쁘다', () => {
  const g = mkGame('1', 'A', [[30, true]]);
  g.ach.achievements[0].unlockTime = 0;
  const r = checkPick({ appid: '1', apiname: '1_A0', pickedAt: NOW - 500 }, { games: [g] });
  assert.equal(r.status, 'done');
});

test('게임이나 도전과제가 캐시에서 사라져도 pending 으로 버틴다', () => {
  assert.equal(checkPick({ appid: 'x', apiname: 'y', pickedAt: 1 }, { games: [] }).status, 'pending');
});

// ── 루프 진행 ─────────────────────────────────────────────────────

test('현재 뽑기가 없으면 만들어준다', () => {
  const cache = { games: [pacedGame('3', 'A', 200)] };
  const { state, justCompleted } = advance(emptyState('7'), cache, { now: NOW, rng: firstRng });
  assert.ok(state.current.cards.length >= 1);
  assert.equal(state.current.picked, null);
  assert.equal(justCompleted, null);
});

test('깨면 히스토리로 넘어가고 즉시 새 3장이 나온다', () => {
  const cache = { games: [pacedGame('3', 'A', 200), mkGame('9', 'B', [[30, false], [40, false], [50, false], [60, true, ago(150)]])] };
  let st = advance(emptyState('7'), cache, { now: NOW, rng: firstRng }).state;
  st = pick(st, 0, NOW).state;
  const target = st.current.cards[0];

  // 유저가 실제로 깼다고 가정
  const after = JSON.parse(JSON.stringify(cache));
  const g = after.games.find((x) => x.appid === target.appid);
  const a = g.ach.achievements.find((x) => x.apiname === target.apiname);
  a.achieved = true;
  a.unlockTime = NOW + 60;

  const { state, justCompleted } = advance(st, after, { now: NOW + 120, rng: firstRng });
  assert.equal(justCompleted.apiname, target.apiname);
  assert.equal(state.history[0].status, 'done');
  assert.equal(state.stats.done, 1);
  assert.equal(state.current.picked, null, '새 뽑기는 선택 전 상태');
});

test('안 깨면 고른 카드가 계속 걸려 있다 — 만료도 벌칙도 없다', () => {
  const cache = { games: [pacedGame('3', 'A', 200)] };
  let st = advance(emptyState('7'), cache, { now: NOW, rng: firstRng }).state;
  st = pick(st, 0, NOW).state;
  const before = JSON.stringify(st.current);
  // 열흘 뒤에 다시 와도 그대로
  const { state, justCompleted } = advance(st, cache, { now: NOW + 10 * DAY, rng: firstRng });
  assert.equal(justCompleted, null);
  assert.equal(JSON.stringify(state.current), before);
});

test('선택은 한 번만', () => {
  const cache = { games: [pacedGame('3', 'A', 200)] };
  let st = advance(emptyState('7'), cache, { now: NOW, rng: firstRng }).state;
  st = pick(st, 0, NOW).state;
  assert.deepEqual(pick(st, 0, NOW), { ok: false, error: 'already-picked' });
});

test('없는 카드는 못 고른다', () => {
  const cache = { games: [pacedGame('3', 'A', 200)] };
  const st = advance(emptyState('7'), cache, { now: NOW, rng: firstRng }).state;
  assert.deepEqual(pick(st, 99, NOW), { ok: false, error: 'no-such-card' });
});

// ── 재뽑기 / 포기 ─────────────────────────────────────────────────

test('재뽑기는 하루 1번', () => {
  const cache = { games: [pacedGame('3', 'A', 200), mkGame('9', 'B', [[30, false], [40, false], [50, false], [60, true, ago(150)]])] };
  let st = advance(emptyState('7'), cache, { now: NOW, rng: firstRng }).state;
  const first = reroll(st, cache, { now: NOW, rng: firstRng });
  assert.equal(first.ok, true);
  const second = reroll(first.state, cache, { now: NOW + 60, rng: firstRng });
  assert.deepEqual(second, { ok: false, error: 'no-rerolls-left' });
  // 다음 날이면 다시 된다
  assert.equal(reroll(first.state, cache, { now: NOW + DAY, rng: firstRng }).ok, true);
});

test('고른 뒤에는 재뽑기 불가 — 선택에 무게를 준다', () => {
  const cache = { games: [pacedGame('3', 'A', 200)] };
  let st = advance(emptyState('7'), cache, { now: NOW, rng: firstRng }).state;
  st = pick(st, 0, NOW).state;
  assert.deepEqual(reroll(st, cache, { now: NOW }), { ok: false, error: 'already-picked' });
});

test('포기하면 조용히 기록되고 새로 뽑는다 (재뽑기 1회 소비)', () => {
  const cache = { games: [pacedGame('3', 'A', 200), mkGame('9', 'B', [[30, false], [40, false], [50, false], [60, true, ago(150)]])] };
  let st = advance(emptyState('7'), cache, { now: NOW, rng: firstRng }).state;
  st = pick(st, 0, NOW).state;
  const r = giveUp(st, cache, { now: NOW + 10, rng: firstRng });
  assert.equal(r.ok, true);
  assert.equal(r.state.history[0].status, 'gave_up');
  assert.equal(r.state.stats.done, 0, '포기는 성공 집계에 안 들어간다');
  assert.equal(rerollAvailable(r.state, NOW + 20), false);
});

test('고른 게 없으면 포기할 것도 없다', () => {
  const cache = { games: [pacedGame('3', 'A', 200)] };
  const st = advance(emptyState('7'), cache, { now: NOW, rng: firstRng }).state;
  assert.deepEqual(giveUp(st, cache, { now: NOW }), { ok: false, error: 'nothing-picked' });
});

// ── 저장소 ────────────────────────────────────────────────────────

test('저장하고 다시 읽으면 같다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-state-'));
  const st = { ...emptyState('765'), stats: { done: 3 } };
  assert.equal(saveState(dir, '765', st), true);
  assert.deepEqual(loadState(dir, '765').stats, { done: 3 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('파일이 없거나 깨졌으면 빈 상태로 시작한다 — 터지지 않는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-state-'));
  assert.deepEqual(loadState(dir, 'nobody'), emptyState('nobody'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state_broken.json'), '{ this is not json');
  assert.deepEqual(loadState(dir, 'broken'), emptyState('broken'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('히스토리는 상한을 넘지 않는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-state-'));
  const st = { ...emptyState('765'), history: Array.from({ length: HISTORY_LIMIT + 50 }, (_, i) => ({ i })) };
  saveState(dir, '765', st);
  assert.equal(loadState(dir, '765').history.length, HISTORY_LIMIT);
  fs.rmSync(dir, { recursive: true, force: true });
});
