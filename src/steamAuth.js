// Steam OpenID 2.0 로그인 ("Sign in through Steam").
// 흐름:
//  1) 로컬 콜백 서버를 127.0.0.1:PORT 에 띄운다.
//  2) Electron 창으로 Steam OpenID 로그인 페이지를 연다.
//  3) 로그인 성공 시 Steam이 return_to(=로컬 서버)로 리다이렉트 → SteamID64 추출.
//  4) (선택) check_authentication 으로 위조 아님을 검증.
const http = require('http');
const https = require('https');
const { URL, URLSearchParams } = require('url');
const { BrowserWindow } = require('electron');

const PORT = 53892; // 임의의 로컬 포트
const REALM = `http://127.0.0.1:${PORT}`;
const RETURN_TO = `${REALM}/callback`;

function buildLoginUrl() {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': RETURN_TO,
    'openid.realm': REALM,
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

// 리다이렉트로 받은 파라미터를 Steam에 되돌려보내 위조 여부 검증.
function verifyAssertion(query) {
  return new Promise((resolve) => {
    const params = new URLSearchParams(query);
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

// 로그인 실행 → SteamID64 문자열을 resolve.
function login() {
  return new Promise((resolve, reject) => {
    let authWin = null;
    const server = http.createServer(async (req, res) => {
      if (!req.url.startsWith('/callback')) {
        res.writeHead(404);
        res.end();
        return;
      }
      const url = new URL(req.url, REALM);
      const query = url.search.replace(/^\?/, '');
      const claimedId = url.searchParams.get('openid.claimed_id');
      const steamId = extractSteamId(claimedId);

      const ok = steamId ? await verifyAssertion(query) : false;

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        ok
          ? '<h2>로그인 완료 ✅ 이 창을 닫아도 됩니다.</h2>'
          : '<h2>로그인 실패 ❌ 앱으로 돌아가 다시 시도해주세요.</h2>'
      );

      server.close();
      if (authWin && !authWin.isDestroyed()) authWin.close();

      if (ok && steamId) resolve(steamId);
      else reject(new Error('OpenID 검증 실패'));
    });

    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => {
      authWin = new BrowserWindow({
        width: 800,
        height: 700,
        title: 'Steam 로그인',
        autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      authWin.loadURL(buildLoginUrl());
      authWin.on('closed', () => {
        authWin = null;
        // 사용자가 로그인 안 하고 창을 닫은 경우
        try { server.close(); } catch (_e) {}
      });
    });
  });
}

module.exports = { login };
