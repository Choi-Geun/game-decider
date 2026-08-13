const test = require('node:test');
const assert = require('node:assert');
const { bucketOf, groupByBucket, BUCKETS } = require('../src/genreBuckets');

const COOP = ['Multi-player', 'Co-op', 'Online Co-op'];
const PVP = ['Multi-player', 'PvP', 'Online PvP'];

test('협동 스토리 — 둘이 같이 진행하는 서사물', () => {
  assert.equal(bucketOf({ genres: ['Action', 'Adventure'], categories: COOP }), 'coopStory');
  assert.equal(bucketOf({ genres: ['Adventure', 'Casual', 'Indie'], categories: COOP }), 'coopStory',
    'We Were Here 처럼 Casual 이 붙어도 PvP 가 없으면 파티가 아니다');
});

test('장르가 확실하면 오염된 태그를 무시한다', () => {
  // 실측: SteamSpy 가 It Takes Two 를 "Life Sim, Dating Sim, Romance" 로 준다
  const itTakesTwo = {
    genres: ['Action', 'Adventure'], categories: COOP,
    tags: ['Life Sim', 'Dating Sim', 'Romance', 'Building', 'Sandbox'],
  };
  assert.equal(bucketOf(itTakesTwo), 'coopStory');
});

test('파티 — 캐주얼한데 서로 붙는 것', () => {
  assert.equal(bucketOf({ genres: ['Action', 'Casual', 'Indie'], categories: PVP }), 'party');
  assert.equal(bucketOf({ genres: ['Casual'], categories: COOP, tags: ['Party Game'] }), 'party');
});

test('로그라이크 — 장르엔 없고 태그로만 잡힌다', () => {
  // Risk of Rain 2 의 장르는 "Action, Indie" 가 전부다
  const ror2 = {
    genres: ['Action', 'Indie'], categories: [...COOP, 'PvP'],
    tags: ['Third-Person Shooter', 'Action Roguelike', 'Rogue-lite', 'Co-op'],
  };
  assert.equal(bucketOf(ror2), 'roguelike');
});

test('생존 · 건설', () => {
  const unrailed = {
    genres: ['Action', 'Casual', 'Indie', 'Simulation'], categories: COOP,
    tags: ['Open World Survival Craft', 'Sandbox', 'Survival', 'Crafting', 'Building'],
  };
  assert.equal(bucketOf(unrailed), 'survival');
});

test('슈팅 · 경쟁 — 협동 없이 맞붙는 것', () => {
  assert.equal(bucketOf({ genres: ['Action', 'Adventure'], categories: PVP, tags: ['Battle Royale', 'Shooter'] }), 'shooter');
  assert.equal(bucketOf({ genres: ['Action'], categories: PVP }), 'shooter', '태그가 없어도 PvP 전용이면 경쟁');
});

test('전략 · 보드게임', () => {
  assert.equal(bucketOf({ genres: ['Casual', 'Indie', 'Strategy'], categories: PVP, tags: ['Board Game'] }), 'strategy');
});

test('오픈월드', () => {
  assert.equal(bucketOf({ genres: ['Action'], categories: COOP, tags: ['Open World', 'Exploration'] }), 'openworld');
});

test('태그가 아직 없어도 장르만으로 최소 분류한다', () => {
  // 태그 수집은 회차를 나눠 채워지므로, 그 전에도 뭔가로 묶여야 한다
  assert.equal(bucketOf({ genres: ['Action'], categories: COOP }), 'coopStory');
  assert.equal(bucketOf({ genres: ['Casual'], categories: [] }), 'party');
  assert.equal(bucketOf({ genres: [], categories: [] }), 'etc');
});

test('빈 입력에도 터지지 않는다', () => {
  assert.equal(bucketOf({}), 'etc');
});

test('groupByBucket 은 정해진 순서를 지키고 빈 그룹은 뺀다', () => {
  const games = [
    { name: 'A', genres: ['Adventure'], categories: COOP },
    { name: 'B', genres: ['Casual'], categories: PVP },
    { name: 'C', genres: ['Adventure'], categories: COOP },
  ];
  const groups = groupByBucket(games);
  assert.deepEqual(groups.map((g) => g.key), ['coopStory', 'party']);
  assert.equal(groups[0].games.length, 2);
  assert.ok(groups.every((g) => BUCKETS.includes(g.key)));
});

test('배틀로얄은 Survival 태그가 있어도 경쟁으로 — PUBG 가 생존으로 가던 문제', () => {
  const pubg = {
    genres: ['Action', 'Adventure', 'Massively Multiplayer'], categories: ['Multi-player', 'PvP', 'Online PvP'],
    tags: ['Survival', 'Shooter', 'Battle Royale', 'Multiplayer'],
  };
  assert.equal(bucketOf(pubg), 'shooter');
});
