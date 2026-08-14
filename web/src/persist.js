// 로컬 파일 ↔ 원격 저장소를 잇는 층.
//
// 규칙: **원격은 durable 백업, 로컬 디스크는 핫 캐시.**
// 캐시는 거의 모든 API 요청에서 동기로 읽힌다(loadCache 10곳). 이걸 매번
// 네트워크로 바꾸면 요청마다 왕복이 붙는다. 그래서 읽기 경로는 손대지 않고,
//  - 유저당 한 번만 원격 → 로컬로 내려받고 (hydrate)
//  - 쓰기는 로컬 먼저, 원격 push 는 뒤에서 (실패해도 요청은 성공)
//
// 원격이 꺼져 있으면(미설정) 전부 no-op 이라 로컬 개발은 지금과 똑같이 동작한다.
const fs = require('fs');
const path = require('path');

function createPersistence({ remote, cacheDir, stateDir, log = () => {} }) {
  // steamId -> 'ok' | 'degraded'
  //  ok       = 원격을 제대로 읽었다. 로컬이 최신이므로 백업해도 안전하다.
  //  degraded = 원격을 못 읽었다. 로컬이 비어 있을 수 있으므로 **절대 백업하지 않는다.**
  //             (안 그러면 빈 상태가 멀쩡한 백업을 덮어쓴다)
  const status = new Map();
  // 동시 요청이 같은 유저를 두 번 내려받지 않게 (진행 중인 약속을 공유)
  const inFlight = new Map();

  const cacheFile = (steamId) => path.join(cacheDir, `cache_${steamId}.json`);
  const stateFile = (steamId) => path.join(stateDir, `state_${steamId}.json`);

  function writeLocal(file, buf) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file); // 쓰는 도중 죽어도 기존 파일이 안 깨진다
  }

  /**
   * 원격에 있는 이 유저의 데이터를 로컬로 내려받는다.
   * 로컬에 이미 있으면 건드리지 않는다 — 로컬이 항상 더 최신이다.
   */
  async function hydrate(steamId) {
    if (!remote.isEnabled() || status.has(steamId)) return;
    if (inFlight.has(steamId)) return inFlight.get(steamId);

    const job = (async () => {
      const jobs = [
        { kind: 'cache', file: cacheFile(steamId) },
        { kind: 'state', file: stateFile(steamId) },
      ].filter((j) => !fs.existsSync(j.file)); // 로컬이 있으면 그게 최신이다

      // 순차로 하면 느린 원격에서 대기시간이 두 배가 된다. 유저의 첫 요청이 걸려 있다.
      const results = await Promise.all(
        jobs.map(async (j) => {
          try {
            const r = await remote.pull(j.kind, steamId);
            if (r.status === 'ok' && r.data) {
              writeLocal(j.file, r.data);
              log(`복원 ${j.kind} ${steamId} (${(r.data.length / 1024).toFixed(0)}KB)`);
            }
            return r.status;
          } catch (_e) {
            return 'error';
          }
        })
      );

      const degraded = results.includes('error');
      if (degraded) {
        log(`⚠️ ${steamId} 원격을 못 읽었습니다 — 이 세션은 백업하지 않습니다 (덮어쓰기 방지)`);
      }
      status.set(steamId, degraded ? 'degraded' : 'ok');
      inFlight.delete(steamId);
    })();

    inFlight.set(steamId, job);
    return job;
  }

  /** 로컬 파일을 원격으로 올린다. 요청 경로를 막지 않도록 절대 던지지 않는다. */
  async function push(kind, steamId) {
    if (!remote.isEnabled()) return false;
    // 원격을 못 읽었던 유저는 로컬이 진짜 최신인지 알 수 없다.
    // 여기서 올리면 빈 상태가 멀쩡한 백업을 지운다.
    if (status.get(steamId) === 'degraded') {
      log(`백업 건너뜀 ${kind} ${steamId} — 복원 실패 상태`);
      return false;
    }
    const file = kind === 'cache' ? cacheFile(steamId) : stateFile(steamId);
    try {
      const buf = fs.readFileSync(file);
      const ok = await remote.push(kind, steamId, buf);
      if (!ok) log(`⚠️ ${kind} 백업 실패 ${steamId}`);
      return ok;
    } catch (_e) {
      return false;
    }
  }

  return {
    hydrate,
    pushCache: (steamId) => push('cache', steamId),
    pushState: (steamId) => push('state', steamId),
    enabled: () => remote.isEnabled(),
    statusOf: (steamId) => status.get(steamId) || 'unknown',
  };
}

module.exports = { createPersistence };
