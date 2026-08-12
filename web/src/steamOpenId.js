// 웹용 Steam OpenID 2.0 헬퍼 (서버 사이드 리다이렉트 방식).
// 데스크톱(steamAuth.js)과 달리 브라우저 리다이렉트로 처리한다.
const https = require('https');
const { URLSearchParams } = require('url');

// 로그인 시작 URL — 사용자를 여기로 리다이렉트한다.
function buildLoginUrl(realm, returnTo) {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': realm,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `https://steamcommunity.com/openid/login?${params.toString()}`;
}

// claimed_id 예: https://steamcommunity.com/openid/id/76561198000000000
function extractSteamId(claimedId) {
  const m = /\/openid\/id\/(\d+)$/.exec(claimedId || '');
  return m ? m[1] : null;
}

// 리다이렉트로 돌아온 쿼리를 Steam에 되돌려보내 위조 여부 검증.
// query: req.query 객체
function verifyAssertion(query) {
  return new Promise((resolve) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) params.set(k, v);
    params.set('openid.mode', 'check_authentication');
    const body = params.toString();
    const req = https.request(
      {
        hostname: 'steamcommunity.com',
        path: '/openid/login',
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(/is_valid\s*:\s*true/.test(data)));
      }
    );
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

module.exports = { buildLoginUrl, extractSteamId, verifyAssertion };
