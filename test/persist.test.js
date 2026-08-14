// 원격 백업 층 테스트.
// 핵심은 "원격이 없거나 죽어도 앱이 그대로 돌아간다" — 이게 깨지면
// Supabase 장애가 곧 서비스 장애가 된다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { objectPath } = require('../web/src/remoteStore');
const { createPersistence } = require('../web/src/persist');

function tmpDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-persist-'));
  return { root, cacheDir: path.join(root, '.cache'), stateDir: path.join(root, '.state') };
}

// 원격을 흉내 낸다. 실제 HTTPS 를 타지 않는다.
function fakeRemote({ enabled = true, data = {}, failPush = false, failPull = false } = {}) {
  const calls = { pull: [], push: [] };
  return {
    calls,
    isEnabled: () => enabled,
    async pull(kind, steamId) {
      calls.pull.push(`${kind}/${steamId}`);
      if (failPull) return { status: 'error', data: null };
      const hit = data[`${kind}/${steamId}`];
      return hit ? { status: 'ok', data: hit } : { status: 'missing', data: null };
    },
    async push(kind, steamId, buf) {
      calls.push.push(`${kind}/${steamId}`);
      if (failPush) return false;
      data[`${kind}/${steamId}`] = buf;
      return true;
    },
  };
}

test('objectPath — SteamID 에 경로 조작을 못 넣는다', () => {
  assert.equal(objectPath('cache', '76561198079687104'), 'cache/76561198079687104.json.gz');
  assert.equal(objectPath('state', '123'), 'state/123.json.gz');
  assert.throws(() => objectPath('cache', '../../etc/passwd'), /숫자/);
  assert.throws(() => objectPath('cache', '123/../..'), /숫자/);
  assert.throws(() => objectPath('secrets', '123'), /알 수 없는 종류/);
});

test('hydrate — 로컬에 없으면 원격에서 내려받는다', async () => {
  const { cacheDir, stateDir } = tmpDirs();
  const remote = fakeRemote({
    data: {
      'cache/123': Buffer.from('{"games":[]}'),
      'state/123': Buffer.from('{"version":1}'),
    },
  });
  const p = createPersistence({ remote, cacheDir, stateDir });

  await p.hydrate('123');

  assert.equal(fs.readFileSync(path.join(cacheDir, 'cache_123.json'), 'utf8'), '{"games":[]}');
  assert.equal(fs.readFileSync(path.join(stateDir, 'state_123.json'), 'utf8'), '{"version":1}');
});

test('hydrate — 로컬이 이미 있으면 원격으로 덮어쓰지 않는다', async () => {
  const { cacheDir, stateDir } = tmpDirs();
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'cache_123.json'), 'LOCAL-최신');

  const remote = fakeRemote({ data: { 'cache/123': Buffer.from('원격-옛날') } });
  const p = createPersistence({ remote, cacheDir, stateDir });
  await p.hydrate('123');

  // 로컬이 항상 더 최신이다 — 원격을 조회하지도 않아야 한다
  assert.equal(fs.readFileSync(path.join(cacheDir, 'cache_123.json'), 'utf8'), 'LOCAL-최신');
  assert.ok(!remote.calls.pull.includes('cache/123'));
});

test('hydrate — 유저당 한 번만 내려받는다 (동시 요청 포함)', async () => {
  const { cacheDir, stateDir } = tmpDirs();
  const remote = fakeRemote({ data: { 'cache/123': Buffer.from('x') } });
  const p = createPersistence({ remote, cacheDir, stateDir });

  await Promise.all([p.hydrate('123'), p.hydrate('123'), p.hydrate('123')]);
  await p.hydrate('123');

  assert.equal(remote.calls.pull.filter((c) => c === 'cache/123').length, 1);
});

test('원격이 죽어도 hydrate 는 던지지 않는다', async () => {
  const { cacheDir, stateDir } = tmpDirs();
  const p = createPersistence({ remote: fakeRemote({ failPull: true }), cacheDir, stateDir });
  await assert.doesNotReject(() => p.hydrate('123'));
});

test('원격이 꺼져 있으면 전부 no-op — 로컬 개발이 그대로 동작한다', async () => {
  const { cacheDir, stateDir } = tmpDirs();
  const remote = fakeRemote({ enabled: false });
  const p = createPersistence({ remote, cacheDir, stateDir });

  await p.hydrate('123');
  assert.equal(await p.pushState('123'), false);
  assert.equal(remote.calls.pull.length, 0);
  assert.equal(remote.calls.push.length, 0);
  assert.equal(p.enabled(), false);
});

test('push — 로컬 파일을 올리고, 파일이 없으면 조용히 실패한다', async () => {
  const { cacheDir, stateDir } = tmpDirs();
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'state_123.json'), '{"done":7}');

  const remote = fakeRemote();
  const p = createPersistence({ remote, cacheDir, stateDir });

  assert.equal(await p.pushState('123'), true);
  assert.equal(await p.pushCache('123'), false); // 캐시 파일은 없다
  assert.deepEqual(remote.calls.push, ['state/123']);
});

test('백업 실패가 예외로 새어나오지 않는다', async () => {
  const { cacheDir, stateDir } = tmpDirs();
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'state_123.json'), '{}');
  const p = createPersistence({ remote: fakeRemote({ failPush: true }), cacheDir, stateDir });
  assert.equal(await p.pushState('123'), false);
});

// ── 여기부터가 진짜 위험한 경로 ──────────────────────────────────
// 원격을 못 읽으면 loadState 가 빈 상태를 돌려준다 → 유저가 새로 뽑는다
// → 그 빈 상태를 백업으로 올린다 → 멀쩡한 기록이 지워진다.
// 백업하려다 백업을 날리는 경로라서, 못 읽었으면 아예 안 올려야 한다.

test('복원 실패한 유저는 백업하지 않는다 — 빈 상태가 기록을 덮어쓰는 걸 막는다', async () => {
  const data = { 'state/123': Buffer.from('{"stats":{"done":42}}') };
  const remote = fakeRemote({ data, failPull: true });
  const { cacheDir, stateDir } = tmpDirs();
  const p = createPersistence({ remote, cacheDir, stateDir });

  await p.hydrate('123');
  assert.equal(p.statusOf('123'), 'degraded');

  // 복원 실패 → 앱은 빈 상태로 시작하고 유저가 새로 뽑아 저장한다
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'state_123.json'), '{"stats":{"done":0}}');
  assert.equal(await p.pushState('123'), false);

  // 원격의 기록 42 가 그대로 살아 있어야 한다
  assert.equal(String(data['state/123']), '{"stats":{"done":42}}');
});

test('원격에 아직 없는 신규 유저는 정상 취급 — 첫 백업이 올라가야 한다', async () => {
  const data = {}; // 아무것도 없음 = missing (error 아님)
  const remote = fakeRemote({ data });
  const { cacheDir, stateDir } = tmpDirs();
  const p = createPersistence({ remote, cacheDir, stateDir });

  await p.hydrate('999');
  assert.equal(p.statusOf('999'), 'ok');

  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'state_999.json'), '{"first":true}');
  assert.equal(await p.pushState('999'), true);
  assert.equal(String(data['state/999']), '{"first":true}');
});

test('왕복 — 재배포로 로컬이 비어도 기록이 살아난다', async () => {
  const data = {};
  const remote = fakeRemote({ data });

  // 배포 1: 기록을 남기고 백업
  const a = tmpDirs();
  fs.mkdirSync(a.stateDir, { recursive: true });
  fs.writeFileSync(path.join(a.stateDir, 'state_123.json'), '{"stats":{"done":12}}');
  await createPersistence({ remote, cacheDir: a.cacheDir, stateDir: a.stateDir }).pushState('123');

  // 배포 2: 디스크가 통째로 비어 있다
  const b = tmpDirs();
  await createPersistence({ remote, cacheDir: b.cacheDir, stateDir: b.stateDir }).hydrate('123');

  assert.equal(
    fs.readFileSync(path.join(b.stateDir, 'state_123.json'), 'utf8'),
    '{"stats":{"done":12}}'
  );
});
