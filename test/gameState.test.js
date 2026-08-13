const test = require('node:test');
const assert = require('node:assert');
const { deriveSignals, classify, classifyLibrary, closestToDone } = require('../src/gameState');
const { pickNextAchievement, lastUnlockedAchievement, buildResume } = require('../src/resume');

const DAY = 86400;
const NOW = 1786000000; // 테스트 고정 기준 시각
const ago = (days) => NOW - days * DAY;

// 도전과제 n개짜리 게임을 만든다. unlocked 개는 주어진 시각들에 달성.
function mkGame(over = {}) {
  const {
    total = 10,
    unlockAt = [],
    globalPercents = null,
    playtimeMinutes = 600,
    playtime2weeks = 0,
    name = 'Test Game',
    appid = '1',
  } = over;
  const achievements = [];
  for (let i = 0; i < total; i++) {
    const achieved = i < unlockAt.length;
    achievements.push({
      apiname: 'A' + i,
      name: 'Ach ' + i,
      description: '',
      achieved,
      unlockTime: achieved ? unlockAt[i] : 0,
      globalPercent: globalPercents ? globalPercents[i] : 50 - i,
    });
  }
  const unlocked = unlockAt.length;
  return {
    appid,
    name,
    playtimeMinutes,
    playtime2weeks,
    lastPlayed: unlockAt.length ? unlockAt[unlockAt.length - 1] : 0,
    ach: {
      hasAchievements: total > 0,
      total,
      unlocked,
      completionPct: total ? Math.round((unlocked / total) * 100) : 0,
      achievements,
    },
  };
}

test('도전과제가 3개 이하면 무한형 — CS2가 1/1로 "완주"되는 거짓 신호 차단', () => {
  const cs2 = mkGame({ total: 1, unlockAt: [ago(900)], playtimeMinutes: 47 });
  const s = deriveSignals(cs2, NOW);
  assert.equal(s.hasAch, false);
  assert.equal(classify(s), '무한형');
});

test('lastUnlock 은 마지막 달성 시각, dormantDays 는 그 뒤 경과일', () => {
  const g = mkGame({ unlockAt: [ago(200), ago(150), ago(90)] });
  const s = deriveSignals(g, NOW);
  assert.equal(s.lastUnlock, ago(90));
  assert.equal(s.firstUnlock, ago(200));
  assert.equal(s.dormantDays, 90);
});

test('unlockPace 는 같은 시기 안의 간격만 쓴다 — 몇 달짜리 공백은 제외', () => {
  // 1시간 간격 4번 → 한참 뒤(200일) 다시 1시간 간격 2번
  const base = ago(400);
  const t = [base, base + 3600, base + 7200, base + 10800, base + 200 * DAY, base + 200 * DAY + 3600];
  const s = deriveSignals(mkGame({ unlockAt: t }), NOW);
  // 200일짜리 공백이 섞였다면 중앙값이 터무니없이 커진다
  assert.equal(s.unlockPaceMinutes, 60);
  assert.equal(s.burstCount, 2, '7일 넘게 벌어지면 다른 시기로 센다');
});

test('unlockPace 는 표본이 적으면 null — 근거 없는 수치를 만들지 않는다', () => {
  const s = deriveSignals(mkGame({ unlockAt: [ago(10), ago(10) + 3600] }), NOW);
  assert.equal(s.unlockPaceMinutes, null);
});

test('세션 규모를 넘는 페이스는 null — "1383분에 하나씩"은 계획에 쓸모없다', () => {
  const base = ago(300);
  const H = 3600;
  // 같은 시기(7일 이내)이긴 한데 간격이 하루 가까이 — 보드게임류
  const t = [base, base + 20 * H, base + 40 * H, base + 60 * H];
  const s = deriveSignals(mkGame({ unlockAt: t }), NOW);
  assert.equal(s.burstCount, 1, '7일 이내라 같은 시기로 묶인다');
  assert.equal(s.unlockPaceMinutes, null);
});

test('동시 달성으로 중앙값이 0이 되면 평균으로 대체', () => {
  const base = ago(100);
  // 간격: 0, 0, 0, 7200 → 중앙값 0
  const t = [base, base, base, base, base + 7200];
  const s = deriveSignals(mkGame({ unlockAt: t }), NOW);
  assert.ok(s.unlockPaceMinutes > 0, '0분이 나오면 안 된다');
});

test('상태 분류', () => {
  const c = (g) => classify(deriveSignals(g, NOW));
  assert.equal(c(mkGame({ playtimeMinutes: 0, unlockAt: [] })), '미개봉');
  assert.equal(c(mkGame({ playtime2weeks: 120, unlockAt: [ago(3)] })), '진행중');
  assert.equal(c(mkGame({ unlockAt: [ago(5)] })), '진행중', '최근에 뭔가 깼으면 진행중');
  assert.equal(c(mkGame({ playtimeMinutes: 40, unlockAt: [ago(300)] })), '찍먹', '2시간 미만 + 오래 방치');
  assert.equal(c(mkGame({ playtimeMinutes: 900, unlockAt: [ago(120)] })), '중도이탈');
  assert.equal(
    c(mkGame({ total: 10, unlockAt: Array.from({ length: 10 }, (_, i) => ago(300 - i)) })),
    '완주'
  );
});

test('closestToDone 은 절대 임계값이 아니라 상대 순위 — 어떤 라이브러리에서도 비지 않는다', () => {
  // 실측에서 본인 라이브러리는 "3개 이하 남음"이 0개였다. 그래도 결과가 나와야 한다.
  const games = [
    mkGame({ appid: '1', name: '33%', total: 100, unlockAt: Array.from({ length: 33 }, (_, i) => ago(200 + i)) }),
    mkGame({ appid: '2', name: '9%', total: 100, unlockAt: Array.from({ length: 9 }, (_, i) => ago(200 + i)) }),
    mkGame({ appid: '3', name: '82%', total: 100, unlockAt: Array.from({ length: 82 }, (_, i) => ago(200 + i)) }),
  ];
  const top = closestToDone(classifyLibrary(games, NOW), 2);
  assert.equal(top.length, 2);
  assert.equal(top[0].game.name, '82%');
  assert.equal(top[1].game.name, '33%');
});

test('closestToDone 은 완주·미개봉·무한형을 제외한다', () => {
  const games = [
    mkGame({ appid: '1', name: '완주', total: 10, unlockAt: Array.from({ length: 10 }, (_, i) => ago(50 + i)) }),
    mkGame({ appid: '2', name: '미개봉', total: 10, unlockAt: [], playtimeMinutes: 0 }),
    mkGame({ appid: '3', name: '무한형', total: 2, unlockAt: [ago(5)] }),
    mkGame({ appid: '4', name: '진행중', total: 10, unlockAt: [ago(5), ago(4)] }),
  ];
  const top = closestToDone(classifyLibrary(games, NOW), 10);
  assert.deepEqual(top.map((t) => t.game.name), ['진행중']);
});

test('다음 목표는 마지막으로 깬 것보다 흔한 것 중 가장 덜 흔한 것 = 바로 다음 한 칸', () => {
  const achievements = [
    { achieved: true, globalPercent: 30, name: '방금 깬 것' },
    { achieved: false, globalPercent: 45, name: '바로 다음' },
    { achieved: false, globalPercent: 80, name: '더 흔한 것' },
    { achieved: false, globalPercent: 5, name: '훨씬 어려운 것' },
  ];
  assert.equal(pickNextAchievement(achievements, 30).name, '바로 다음');
});

test('앞선 것이 없으면 남은 것 중 가장 쉬운 것으로 폴백', () => {
  const achievements = [
    { achieved: true, globalPercent: 90, name: '방금 깬 것' },
    { achieved: false, globalPercent: 20, name: '어려움' },
    { achieved: false, globalPercent: 40, name: '그나마 쉬움' },
  ];
  assert.equal(pickNextAchievement(achievements, 90).name, '그나마 쉬움');
});

test('globalPercent 가 없는 도전과제는 후보에서 빠진다', () => {
  const achievements = [
    { achieved: false, globalPercent: null, name: '미상' },
    { achieved: false, globalPercent: 40, name: '있음' },
  ];
  assert.equal(pickNextAchievement(achievements, null).name, '있음');
  assert.equal(pickNextAchievement([{ achieved: false, globalPercent: null }], null), null);
});

test('lastUnlockedAchievement 는 가장 최근 것을 고른다', () => {
  const achievements = [
    { achieved: true, unlockTime: 100, name: '오래된 것' },
    { achieved: true, unlockTime: 300, name: '최근 것' },
    { achieved: false, unlockTime: 0, name: '안 깬 것' },
  ];
  assert.equal(lastUnlockedAchievement(achievements).name, '최근 것');
});

test('buildResume 은 중도이탈만 담고 가장 최근에 멈춘 것부터 준다', () => {
  const cache = {
    games: [
      mkGame({ appid: '1', name: '오래 전 이탈', total: 10, unlockAt: [ago(300), ago(290)] }),
      mkGame({ appid: '2', name: '최근 이탈', total: 10, unlockAt: [ago(90), ago(80)] }),
      mkGame({ appid: '3', name: '지금 하는 중', total: 10, unlockAt: [ago(2)], playtime2weeks: 300 }),
      mkGame({ appid: '4', name: '완주함', total: 10, unlockAt: Array.from({ length: 10 }, (_, i) => ago(100 + i)) }),
    ],
  };
  const { dropped, active } = buildResume(cache, { now: NOW });
  assert.deepEqual(dropped.map((d) => d.name), ['최근 이탈', '오래 전 이탈']);
  assert.deepEqual(active.map((d) => d.name), ['지금 하는 중']);
});

test('이어하기 카드는 재진입에 필요한 맥락을 담는다', () => {
  const cache = {
    games: [
      mkGame({
        appid: '7',
        name: 'Gloomhaven',
        total: 10,
        unlockAt: [ago(120), ago(110), ago(100)],
        globalPercents: [80, 60, 30, 45, 20, 15, 10, 8, 5, 2],
      }),
    ],
  };
  const card = buildResume(cache, { now: NOW }).dropped[0];
  assert.equal(card.name, 'Gloomhaven');
  assert.equal(card.dormantDays, 100);
  assert.equal(card.completionPct, 30);
  assert.equal(card.remaining, 7);
  assert.equal(card.lastAchievement.name, 'Ach 2', '마지막으로 깬 것');
  assert.equal(card.nextAchievement.name, 'Ach 3', 'globalPercent 45 = 30 바로 위');
  assert.ok(card.timeline.length === 3);
});

test('달성 이력이 하나도 없는 게임은 이어하기에 안 나온다', () => {
  const cache = { games: [mkGame({ total: 10, unlockAt: [], playtimeMinutes: 500 })] };
  assert.equal(buildResume(cache, { now: NOW }).dropped.length, 0);
});
