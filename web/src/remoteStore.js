// 원격 영속 저장소 — Supabase Storage 위의 단순 blob get/put.
//
// 왜 필요한가: Render 무료 플랜은 디스크가 휘발성이라 재배포·슬립 복귀마다
// 유저 캐시(1.7MB)와 뽑기 기록(4KB)이 사라진다. 캐시는 40초 재동기화로 복구되지만
// 기록은 복구 방법이 없다.
//
// 이 모듈은 전송만 안다 (파일 경로·언제 쓸지는 persist.js 가 정한다).
// 의존성을 늘리지 않는다는 원칙에 따라 node:https 로만 호출한다.
// gzip 으로 보낸다 — 실측 1691KB → 210KB (88% 감소).
//
// ⚠️ SERVICE_KEY 는 RLS 를 우회하는 관리자 키다. 서버에만 두고 브라우저로 절대 내보내지 말 것.
const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');

const BUCKET = 'gd-data';

/**
 * blob 하나의 저장 경로. steamId 는 숫자만 허용 — 경로 조작(../)을 원천 차단한다.
 * @param {'cache'|'state'} kind
 * @param {string} steamId
 */
function objectPath(kind, steamId) {
  if (kind !== 'cache' && kind !== 'state') throw new Error(`알 수 없는 종류: ${kind}`);
  if (!/^\d+$/.test(String(steamId))) throw new Error('SteamID 는 숫자여야 합니다');
  return `${kind}/${steamId}.json.gz`;
}

function makeClient(env) {
  const base = (env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_KEY || '';
  const enabled = !!(base && key);

  function request(method, path, body, extraHeaders) {
    return new Promise((resolve) => {
      let url;
      try {
        url = new URL(`${base}/storage/v1/object/${path}`);
      } catch (_e) {
        return resolve({ ok: false, status: 0, body: null });
      }
      const headers = {
        Authorization: `Bearer ${key}`,
        apikey: key,
        ...(extraHeaders || {}),
      };
      if (body) headers['content-length'] = body.length;

      const req = https.request(
        // 8초. 이 호출은 유저의 첫 요청을 붙잡고 있으므로 길면 그대로 체감된다.
        { hostname: url.hostname, path: url.pathname + url.search, method, headers, timeout: 8000 },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              body: Buffer.concat(chunks),
            })
          );
        }
      );
      // 원격이 죽어도 요청 경로를 막으면 안 된다 — 전부 조용히 실패시킨다.
      req.on('error', () => resolve({ ok: false, status: 0, body: null }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: null }); });
      if (body) req.write(body);
      req.end();
    });
  }

  return {
    isEnabled: () => enabled,

    /**
     * 원격에서 받아 gunzip.
     *
     * **'없음'과 '못 읽음'을 반드시 구분한다.** 둘을 뭉뚱그리면,
     * 원격 장애 때 로컬이 빈 상태로 시작하고 → 그 빈 상태가 다시 백업으로 올라가
     * 멀쩡한 기록을 지운다. 백업하려다 백업을 날리는 경로다.
     *
     * @returns {{status:'ok'|'missing'|'error', data:Buffer|null}}
     */
    async pull(kind, steamId) {
      if (!enabled) return { status: 'missing', data: null };
      const res = await request('GET', `${BUCKET}/${objectPath(kind, steamId)}`);
      if (res.status === 404 || res.status === 400) return { status: 'missing', data: null };
      if (!res.ok) return { status: 'error', data: null };
      if (!res.body || !res.body.length) return { status: 'missing', data: null };
      try {
        return { status: 'ok', data: zlib.gunzipSync(res.body) };
      } catch (_e) {
        // blob 이 깨졌다. 없는 것과 다르다 — 덮어쓰면 안 되므로 error 로 본다.
        return { status: 'error', data: null };
      }
    },

    /** gzip 해서 덮어쓴다. 성공 여부만 돌려주고 던지지 않는다. */
    async push(kind, steamId, buffer) {
      if (!enabled) return false;
      let gz;
      try {
        gz = zlib.gzipSync(buffer, { level: 6 });
      } catch (_e) {
        return false;
      }
      const res = await request('POST', `${BUCKET}/${objectPath(kind, steamId)}`, gz, {
        'content-type': 'application/gzip',
        'cache-control': 'no-cache',
        'x-upsert': 'true', // 있으면 덮어쓴다
      });
      return res.ok;
    },
  };
}

module.exports = { makeClient, objectPath, BUCKET };
