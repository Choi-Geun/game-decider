const test = require('node:test');
const assert = require('node:assert');
const { bucketOf, groupByBucket, BUCKETS } = require('../src/genreBuckets');

// 아래 태그들은 전부 실제 Steam 태그를 그대로 옮긴 것이다 (득표순).

test('협동 스토리 — It Takes Two', () => {
  assert.equal(bucketOf({ tags: ['Co-op', 'Multiplayer', 'Split Screen', 'Local Co-Op', 'Puzzle', 'Online Co-Op', 'Adventure', 'Story Rich'] }), 'coopStory');
});

test('로그라이크 — Risk of Rain 2 는 슈터 태그가 앞서도 로그라이크다', () => {
  // Third-Person Shooter 가 1위지만 Action Roguelike/Rogue-lite/Rogue-like 가 겹쳐 이긴다
  assert.equal(bucketOf({ tags: ['Third-Person Shooter', 'Action Roguelike', 'Multiplayer', 'Co-op', 'Action', 'Rogue-lite', 'Rogue-like', 'Looter Shooter'] }), 'roguelike');
});

test('슈팅·경쟁 — PUBG 는 Survival 이 1위여도 배틀로얄이다', () => {
  assert.equal(bucketOf({ tags: ['Survival', 'Shooter', 'Battle Royale', 'Multiplayer', 'FPS', 'PvP', 'Third-Person Shooter', 'Action'] }), 'shooter');
});

test('슈팅·경쟁 — MOBA 도 경쟁으로', () => {
  assert.equal(bucketOf({ tags: ['Free to Play', 'Anime', 'Multiplayer', 'MOBA', 'Survival', 'PvP', 'Combat'] }), 'shooter');
});

test('전략·보드게임 — Gaia Project 는 Casual 이 붙어도 보드게임이다', () => {
  assert.equal(bucketOf({ tags: ['Strategy', 'Casual', 'Board Game', 'Turn-Based Strategy', 'PvP', 'Family Friendly'] }), 'strategy');
});

test('오픈월드 — Monster Hunter / GTA', () => {
  assert.equal(bucketOf({ tags: ['Co-op', 'Multiplayer', 'Action', 'Open World', 'RPG', 'Third Person', 'Adventure'] }), 'openworld');
  assert.equal(bucketOf({ tags: ['Open World', 'Action', 'Multiplayer', 'Crime', 'Automobile Sim', 'Third Person'] }), 'openworld');
});

test('생존·건설 — Once Human', () => {
  assert.equal(bucketOf({ tags: ['Open World', 'Survival', 'Multiplayer', 'Free to Play', 'Open World Survival Craft', 'Co-op', 'Exploration', 'Building'] }), 'survival');
});

test('태그 순위가 가중치로 작동한다 — 1위 태그가 더 세다', () => {
  const front = bucketOf({ tags: ['Board Game', 'Shooter'] });
  const back = bucketOf({ tags: ['Shooter', 'Board Game'] });
  assert.equal(front, 'strategy');
  assert.equal(back, 'shooter', '같은 태그쌍이라도 순서가 바뀌면 결과가 바뀐다');
});

test('파티 — Overcooked 류', () => {
  assert.equal(bucketOf({ tags: ['Local Multiplayer', 'Party Game', 'Co-op', 'Casual', '4 Player Local', 'Funny'] }), 'party');
});

test('태그가 없으면 장르로 폴백한다 — 수집 전에도 뭔가로는 묶인다', () => {
  assert.equal(bucketOf({ tags: [], genres: ['Strategy'], categories: [] }), 'strategy');
  assert.equal(bucketOf({ tags: [], genres: ['Adventure'], categories: ['Co-op'] }), 'coopStory');
  assert.equal(bucketOf({ tags: [], genres: ['Casual'], categories: [] }), 'party');
  assert.equal(bucketOf({ genres: [], categories: [] }), 'etc');
});

test('아는 태그가 하나도 없으면 장르 폴백으로 넘어간다', () => {
  assert.equal(bucketOf({ tags: ['Anime', 'Cute', 'Colorful'], genres: ['Strategy'] }), 'strategy');
});

test('빈 입력에도 터지지 않는다', () => {
  assert.equal(bucketOf({}), 'etc');
});

test('groupByBucket 은 정해진 순서를 지키고 빈 그룹은 뺀다', () => {
  const games = [
    { name: 'A', tags: ['Story Rich', 'Co-op'] },
    { name: 'B', tags: ['Party Game', 'Casual'] },
    { name: 'C', tags: ['Co-op Campaign'] },
  ];
  const groups = groupByBucket(games);
  assert.deepEqual(groups.map((g) => g.key), ['coopStory', 'party']);
  assert.equal(groups[0].games.length, 2);
  assert.ok(groups.every((g) => BUCKETS.includes(g.key)));
});
