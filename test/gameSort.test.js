// 내 게임 정렬.
//
// 처음 만들었을 때 '최근 플레이 순'과 '달성률 높은 순'에서 **값이 없는 게임이
// 맨 앞**에 왔다. 내림차순을 만들려고 비교 인자를 (b, a) 로 뒤집어 넘겼는데
// null 처리까지 같이 뒤집힌 것이다. 방향은 dir 로만 주고 인자는 항상 (a, b).
//
// 플레이 시간 정렬은 삭제됨 — 남은 축은 마지막 플레이·달성률 넷.
// 정렬 로직은 app.js 안에 있어(빌드 없는 순수 JS) 여기서는 같은 규칙을 복제해
// 계약을 고정한다. app.js 쪽을 고치면 이 파일도 같이 고쳐야 한다.
const test = require('node:test');
const assert = require('node:assert');

function nullLast(x, y, dir) {
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return dir > 0 ? x - y : y - x;
}
const pctOf = (g) => (g.ach && g.ach.hasAchievements ? g.ach.completionPct : null);

const SORTS = {
  recent: (a, b) => nullLast(a.lastPlayed || null, b.lastPlayed || null, -1),
  oldest: (a, b) => nullLast(a.lastPlayed || null, b.lastPlayed || null, 1),
  'ach-desc': (a, b) => nullLast(pctOf(a), pctOf(b), -1),
  'ach-asc': (a, b) => nullLast(pctOf(a), pctOf(b), 1),
};

const ach = (pct) => ({ hasAchievements: true, completionPct: pct });
const FIXTURE = [
  { name: '많이함', playtimeMinutes: 9000, lastPlayed: 1700000000, ach: ach(80) },
  { name: '조금함', playtimeMinutes: 30, lastPlayed: 1600000000, ach: ach(0) },
  { name: '안켬', playtimeMinutes: 0, lastPlayed: 0, ach: ach(50) },
  { name: '도전과제없음', playtimeMinutes: 500, lastPlayed: 1650000000, ach: { hasAchievements: false } },
];
const order = (key) => FIXTURE.slice().sort(SORTS[key]).map((g) => g.name);

test('마지막 플레이 — 최근 순 / 오래된 순', () => {
  assert.deepEqual(order('recent'), ['많이함', '도전과제없음', '조금함', '안켬']);
  assert.deepEqual(order('oldest'), ['조금함', '도전과제없음', '많이함', '안켬']);
});

test('달성률 — 높은 순 / 낮은 순', () => {
  assert.deepEqual(order('ach-desc'), ['많이함', '안켬', '조금함', '도전과제없음']);
  assert.deepEqual(order('ach-asc'), ['조금함', '안켬', '많이함', '도전과제없음']);
});

test('값 없는 항목은 어느 방향에서도 맨 뒤 — 이게 원래 버그였다', () => {
  for (const key of Object.keys(SORTS)) {
    const last = order(key).at(-1);
    const expected = key.startsWith('ach') ? '도전과제없음' : '안켬';
    assert.equal(last, expected, `${key}: 값 없는 항목이 뒤로 안 갔다`);
  }
});

test('0% 는 값이 없는 게 아니다 — 낮은 순에서 맨 앞이어야 한다', () => {
  assert.equal(order('ach-asc')[0], '조금함'); // 0%
  assert.notEqual(order('ach-asc').at(-1), '조금함');
});

test('비교 함수가 대칭이다 (a,b 와 b,a 의 부호가 반대)', () => {
  for (const key of Object.keys(SORTS)) {
    for (const a of FIXTURE) {
      for (const b of FIXTURE) {
        const ab = Math.sign(SORTS[key](a, b));
        const ba = Math.sign(SORTS[key](b, a));
        assert.equal(ab, -ba, `${key}: ${a.name} vs ${b.name} 비교가 비대칭`);
      }
    }
  }
});
