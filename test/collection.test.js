const test = require('node:test');
const assert = require('node:assert');
const { buildCollection, tierOf, nextTargets } = require('../src/collection');

const DAY = 86400;
const NOW = 1786000000;
const ago = (days) => NOW - days * DAY;

// achievements 스펙: [globalPercent, achieved, unlockTime?]
function mkGame(appid, name, specs, playtimeMinutes = 100) {
  const achievements = specs.map(([globalPercent, achieved, unlockTime], i) => ({
    apiname: 'A' + i,
    name: `${name} #${i}`,
    description: '',
    achieved,
    unlockTime: achieved ? unlockTime || ago(500) : 0,
    globalPercent,
  }));
  const unlocked = achievements.filter((a) => a.achieved).length;
  return {
    appid,
    name,
    playtimeMinutes,
    ach: {
      hasAchievements: true,
      total: achievements.length,
      unlocked,
      completionPct: Math.round((unlocked / achievements.length) * 100),
      achievements,
    },
  };
}

test('등급 경계', () => {
  assert.equal(tierOf(2.1), 'legendary');
  assert.equal(tierOf(4.99), 'legendary');
  assert.equal(tierOf(5), 'rare');
  assert.equal(tierOf(19.9), 'rare');
  assert.equal(tierOf(20), 'normal');
  assert.equal(tierOf(50), 'common');
  assert.equal(tierOf(null), null, 'globalPercent 없는 건 등급이 없다');
});

test('crown 은 딴 것 중 가장 희귀한 하나 — 헤드라인이 된다', () => {
  const cache = {
    games: [
      mkGame('1', 'Gaia', [[2.1, true], [40, true]]),
      mkGame('2', 'Deep Rock', [[2.7, true], [8, true]]),
    ],
  };
  const c = buildCollection(cache, { now: NOW });
  assert.equal(c.crown.globalPercent, 2.1);
  assert.equal(c.crown.gameName, 'Gaia');
});

test('아직 아무것도 못 깼으면 crown 은 null — 빈 상태가 터지지 않는다', () => {
  const cache = { games: [mkGame('1', 'A', [[10, false], [20, false]])] };
  const c = buildCollection(cache, { now: NOW });
  assert.equal(c.crown, null);
  assert.equal(c.showcase.length, 0);
  assert.equal(c.counts.total, 0);
});

test('등급별 집계는 딴 것만 센다', () => {
  const cache = {
    games: [
      mkGame('1', 'A', [[2, true], [10, true], [30, true], [70, true], [1, false], [3, false]]),
    ],
  };
  const c = buildCollection(cache, { now: NOW });
  assert.deepEqual(c.counts, { legendary: 1, rare: 1, normal: 1, common: 1, total: 4 });
});

test('진열장은 희귀한 것부터, 전설·희귀만', () => {
  const cache = {
    games: [mkGame('1', 'A', [[70, true], [3, true], [30, true], [12, true]])],
  };
  const c = buildCollection(cache, { now: NOW });
  assert.deepEqual(c.showcase.map((a) => a.globalPercent), [3, 12]);
});

test('globalPercent 없는 도전과제는 통째로 빠진다', () => {
  const cache = {
    games: [
      {
        appid: '1', name: 'A', playtimeMinutes: 10,
        ach: {
          hasAchievements: true, total: 2, unlocked: 2, completionPct: 100,
          achievements: [
            { apiname: 'x', name: 'x', achieved: true, unlockTime: ago(1), globalPercent: null },
            { apiname: 'y', name: 'y', achieved: true, unlockTime: ago(1), globalPercent: 4 },
          ],
        },
      },
    ],
  };
  const c = buildCollection(cache, { now: NOW });
  assert.equal(c.counts.total, 1);
  assert.equal(c.crown.globalPercent, 4);
});

test('다음 전설 후보는 전설 중 가장 흔한 것 — 가장 어려운 걸 들이밀면 벽이 된다', () => {
  const games = [mkGame('1', 'A', [[0.5, false], [4.8, false], [3, false], [30, false]])];
  const t = nextTargets(games, 'legendary', 3);
  assert.deepEqual(t.map((x) => x.globalPercent), [4.8, 3, 0.5]);
  assert.ok(t.every((x) => x.globalPercent < 5), '전설 범위만');
});

test('희귀도가 같으면 많이 해본 게임을 우선 — 맥락이 남아 있는 쪽이 실제로 한다', () => {
  const games = [
    mkGame('1', '조금 함', [[3, false]], 20),
    mkGame('2', '많이 함', [[3, false]], 5000),
  ];
  const t = nextTargets(games, 'legendary', 2);
  assert.equal(t[0].gameName, '많이 함');
});

test('이미 깬 것은 다음 후보에 안 나온다', () => {
  const games = [mkGame('1', 'A', [[4, true], [2, false]])];
  const t = nextTargets(games, 'legendary', 5);
  assert.deepEqual(t.map((x) => x.globalPercent), [2]);
});

test('수확은 최근 N일 안에 깬 것만 — 최신순', () => {
  const cache = {
    games: [
      mkGame('1', 'A', [
        [10, true, ago(3)],
        [40, true, ago(10)],
        [5, true, ago(200)],
      ]),
    ],
  };
  const c = buildCollection(cache, { now: NOW, harvestDays: 30 });
  assert.equal(c.harvest.count, 2);
  assert.deepEqual(c.harvest.items.map((a) => a.unlockTime), [ago(3), ago(10)]);
  assert.equal(c.harvest.rarest.globalPercent, 10, '기간 안에서 가장 희귀한 것');
});

test('수확이 없으면 rarest 는 null', () => {
  const cache = { games: [mkGame('1', 'A', [[10, true, ago(300)]])] };
  const c = buildCollection(cache, { now: NOW, harvestDays: 30 });
  assert.equal(c.harvest.count, 0);
  assert.equal(c.harvest.rarest, null);
});

test('진열 개수 제한이 지켜진다', () => {
  const specs = Array.from({ length: 40 }, (_, i) => [1 + i * 0.1, true]);
  const c = buildCollection({ games: [mkGame('1', 'A', specs)] }, { now: NOW, displayLimit: 5 });
  assert.equal(c.showcase.length, 5);
});
