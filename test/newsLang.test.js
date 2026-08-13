const test = require('node:test');
const assert = require('node:assert');
const { detectScript, filterNewsByLang } = require('../src/newsLang');

// 아래 제목들은 ELDEN RING 상세에 실제로 떴던 것들이다.
const RU = '"Один из главных разработчиков современности": Отец Tekken похвалил создателя Dark Souls';
const EN = "Despite investors moaning that Elden Ring's success hasn't been milked hard enough financially";
const KO = '엘든 링 나이트레인, 신규 캐릭터 업데이트 안내';

test('문자권 판별', () => {
  assert.equal(detectScript(RU), 'ru');
  assert.equal(detectScript(EN), 'en');
  assert.equal(detectScript(KO), 'ko');
  assert.equal(detectScript('パッチノート'), 'ja');
  assert.equal(detectScript('更新公告'), 'zh');
  assert.equal(detectScript(''), 'en', '빈 제목은 라틴으로 본다');
  assert.equal(detectScript(undefined), 'en');
});

test('일본어는 한자가 섞여 있어도 가나로 먼저 잡는다', () => {
  assert.equal(detectScript('新機能のお知らせ'), 'ja');
});

test('러시아어 기사를 걸러낸다 — 원래 문제', () => {
  const items = [{ title: RU }, { title: EN }, { title: RU }];
  const out = filterNewsByLang(items, 'english', 4);
  assert.deepEqual(out.map((x) => x.title), [EN]);
});

test('화면이 한국어면 한국어 먼저, 그다음 영어', () => {
  const items = [{ title: EN }, { title: KO }, { title: RU }];
  const out = filterNewsByLang(items, 'korean', 4);
  assert.deepEqual(out.map((x) => x.title), [KO, EN], '한국어가 앞으로');
});

test('화면이 영어면 한국어 기사는 빠진다', () => {
  const items = [{ title: KO }, { title: EN }];
  assert.deepEqual(filterNewsByLang(items, 'english', 4).map((x) => x.title), [EN]);
});

test('영어를 폴백으로 남긴다 — 안 그러면 뉴스 칸이 거의 항상 빈다', () => {
  const items = [{ title: EN }, { title: EN }];
  assert.equal(filterNewsByLang(items, 'korean', 4).length, 2);
});

test('전부 다른 문자권이면 빈 배열 — 억지로 채우지 않는다', () => {
  assert.deepEqual(filterNewsByLang([{ title: RU }, { title: '更新公告' }], 'korean', 4), []);
});

test('개수 상한을 지킨다', () => {
  const items = Array.from({ length: 10 }, () => ({ title: EN }));
  assert.equal(filterNewsByLang(items, 'english', 3).length, 3);
});

test('빈 입력에도 터지지 않는다', () => {
  assert.deepEqual(filterNewsByLang(null, 'ko', 4), []);
  assert.deepEqual(filterNewsByLang([], 'ko', 4), []);
});

test('lang 표기가 ko/korean 어느 쪽이든 동작한다', () => {
  const items = [{ title: KO }, { title: EN }];
  assert.equal(filterNewsByLang(items, 'ko', 4)[0].title, KO);
  assert.equal(filterNewsByLang(items, 'korean', 4)[0].title, KO);
});
