// 게임 디사이더 웹 서버 (멀티유저).
// - API 키는 서버에만 보관 (브라우저에 노출 안 됨).
// - 각 방문자는 Steam OpenID로 로그인 → 자기 SteamID로 조회.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');

// 기존에 만든 로직 재사용 (Electron 비의존 모듈들)
const { loadEnv } = require('../src/env');
const api = require('../src/steamApi');
const cacheStore = require('../src/cache');
const { recommend } = require('../src/recommend');
const { recommendPlus } = require('../src/recommendPlus');
const { buildFriendCoop } = require('../src/friendsCoop');
const openid = require('./src/steamOpenId');

const env = loadEnv(path.join(__dirname, '..', '.env'));

// 회사망 SSL 검사 우회 (개발용)
if (env.INSECURE_TLS === '1') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const API_KEY = env.STEAM_API_KEY;
const PORT = Number(env.PORT || 3000);
const BASE_URL = env.BASE_URL || `http://localhost:${PORT}`;
const CACHE_DIR = path.join(__dirname, '.cache');

const AUTH_SECRET = env.SESSION_SECRET || 'dev-secret-change-me';
const AUTH_COOKIE = 'gd_auth';
const AUTH_MAX_AGE = 1000 * 60 * 60 * 24 * 30; // 30일

// SteamID를 HMAC 서명해 쿠키에 담는다 → 서버 재시작/배포해도 로그인 유지(스테이트리스).
function signId(id) {
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(id).digest('hex');
  return `${id}.${sig}`;
}
function verifyId(val) {
  if (!val || typeof val !== 'string') return null;
  const i = val.lastIndexOf('.');
  if (i < 0) return null;
  const id = val.slice(0, i);
  const sig = val.slice(i + 1);
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(id).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? id : null;
}
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const app = express();
app.use(express.json());
app.use(
  session({
    secret: AUTH_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 7일
  })
);

// 세션이 비어도 서명된 gd_auth 쿠키가 있으면 로그인 자동 복원.
app.use(async (req, res, next) => {
  if (!req.session.steamId) {
    const id = verifyId(parseCookies(req)[AUTH_COOKIE]);
    if (id) {
      req.session.steamId = id;
      if (!req.session.profile) {
        try {
          const p = await api.getPlayerSummary(API_KEY, id);
          if (p) req.session.profile = { name: p.personaname, avatar: p.avatarfull };
        } catch (_e) {}
      }
    }
  }
  next();
});

// 동기화 진행률 (메모리, steamId별)
const syncJobs = new Map(); // steamId -> { done, total, name, status }

// ── 인증 ─────────────────────────────────────────────────────────
app.get('/auth/steam', (req, res) => {
  const realm = BASE_URL;
  const returnTo = `${BASE_URL}/auth/steam/return`;
  res.redirect(openid.buildLoginUrl(realm, returnTo));
});

app.get('/auth/steam/return', async (req, res) => {
  const steamId = openid.extractSteamId(req.query['openid.claimed_id']);
  const ok = steamId ? await openid.verifyAssertion(req.query) : false;
  if (ok && steamId) {
    req.session.steamId = steamId;
    // 서버 재시작에도 로그인 유지되도록 서명된 쿠키 저장
    res.cookie(AUTH_COOKIE, signId(steamId), {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: AUTH_MAX_AGE,
      path: '/',
    });
    // 프로필 이름/아바타 미리 저장
    try {
      const p = await api.getPlayerSummary(API_KEY, steamId);
      if (p) req.session.profile = { name: p.personaname, avatar: p.avatarfull };
    } catch (_e) {}
  }
  // 팝업/새 탭에서 로그인한 경우: 원래 창(opener)에 알리고 이 창은 닫는다.
  res.send(closePopupHtml(ok && !!steamId));
});

// 로그인 팝업이 스스로 닫히고 원래 창에 결과를 알리는 HTML.
// window.open 으로 열렸으면(opener 존재) 자동 닫힘, 아니면 안내 후 홈으로.
function closePopupHtml(success) {
  const msg = success ? '로그인 완료 ✅ 이 창은 곧 닫힙니다.' : '로그인 실패 ❌ 다시 시도해주세요.';
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<title>Steam 로그인</title>
<style>body{background:#14151a;color:#eaeaf0;font-family:-apple-system,"Noto Sans KR",sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}</style></head>
<body><div><h2>${msg}</h2><p id="fb" style="color:#8a8a99;font-size:13px"></p></div>
<script>
  var success = ${success ? 'true' : 'false'};
  try { if (window.opener) { window.opener.postMessage({ type: 'steam-login', success: success }, '*'); } } catch (e) {}
  // 팝업이면 닫고, 일반 탭이면 홈으로 이동
  setTimeout(function () {
    if (window.opener) { window.close(); }
    else { location.href = '/'; }
    document.getElementById('fb').textContent = '자동으로 닫히지 않으면 이 창을 닫아주세요.';
  }, 800);
</script></body></html>`;
}

app.post('/auth/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE, { path: '/' });
  req.session.destroy(() => res.json({ ok: true }));
});

// 로그인 필요 미들웨어
function requireAuth(req, res, next) {
  if (!req.session.steamId) return res.status(401).json({ error: '로그인 필요' });
  next();
}

// ── 상태 ─────────────────────────────────────────────────────────
app.get('/api/me', (req, res) => {
  if (!req.session.steamId) return res.json({ loggedIn: false });
  const cache = cacheStore.loadCache(CACHE_DIR, req.session.steamId);
  res.json({
    loggedIn: true,
    steamId: req.session.steamId,
    profile: req.session.profile || cache?.profile || null,
    hasCache: !!cache,
    count: cache?.games?.length || 0,
    updatedAt: cache?.updatedAt || null,
    achievementsBlocked: !!cache?.achievementsBlocked,
  });
});

// ── 동기화 (백그라운드 잡 + 진행률 폴링) ──────────────────────────
app.post('/api/sync', requireAuth, (req, res) => {
  const steamId = req.session.steamId;
  if (!API_KEY) return res.status(500).json({ error: 'STEAM_API_KEY 미설정' });
  if (syncJobs.get(steamId)?.status === 'running')
    return res.json({ ok: true, already: true });

  const full = req.query.full === '1'; // 기본은 증분, ?full=1 이면 전체
  syncJobs.set(steamId, { done: 0, total: 0, name: '', status: 'running' });
  // 응답은 즉시 반환하고, 실제 수집은 뒤에서 진행
  res.json({ ok: true, started: true, mode: full ? 'full' : 'incremental' });

  cacheStore
    .syncCache(API_KEY, steamId, CACHE_DIR, {
      full,
      onProgress: (done, total, name) => {
        syncJobs.set(steamId, { done, total, name, status: 'running' });
      },
    })
    .then((data) => {
      syncJobs.set(steamId, {
        done: data._stats.fetched,
        total: data._stats.fetched,
        name: '',
        status: 'done',
        stats: data._stats,
        count: data.games.length,
      });
    })
    .catch((e) => {
      syncJobs.set(steamId, { done: 0, total: 0, name: '', status: 'error', error: String(e.message || e) });
    });
});

app.get('/api/sync/progress', requireAuth, (req, res) => {
  res.json(syncJobs.get(req.session.steamId) || { status: 'idle' });
});

// ── 추천 ─────────────────────────────────────────────────────────
// 기분/시간/인원 기반 (보유게임 목록으로)
app.get('/api/recommend', requireAuth, async (req, res) => {
  const cache = cacheStore.loadCache(CACHE_DIR, req.session.steamId);
  const games = cache?.games || [];
  if (!games.length) return res.json({ game: null, reason: '먼저 동기화하세요.' });
  const input = {
    mood: req.query.mood || 'relaxed',
    time: req.query.time || 'medium',
    players: req.query.players || 'solo',
    backlogOnly: req.query.backlog === '1',
    _roll: Number(req.query.roll || 0),
  };
  // 웹에서는 서버의 Claude 키를 쓰지 않고 로컬 로직 사용(원하면 env로 켤 수 있음)
  const result = await recommend(games, input, env);
  res.json(result);
});

// 도전과제/이어하기 기반
app.get('/api/recommend-plus', requireAuth, (req, res) => {
  const cache = cacheStore.loadCache(CACHE_DIR, req.session.steamId);
  if (!cache) return res.json({ game: null, reason: '먼저 동기화하세요.', nextAchievements: [] });
  res.json(recommendPlus(cache, req.query.mode || 'continue'));
});

// 내 게임 전체 (이미지·도전과제 포함) — 새 UI가 슬롯/LNB/도전과제탭에 사용
app.get('/api/games', requireAuth, (req, res) => {
  const cache = cacheStore.loadCache(CACHE_DIR, req.session.steamId);
  if (!cache) return res.json({ games: [], achievementsBlocked: false });
  res.json({
    games: cache.games || [],
    achievementsBlocked: !!cache.achievementsBlocked,
    updatedAt: cache.updatedAt || null,
  });
});

// 친구 기반 코옵 추천 (온디맨드 — 친구 접속상태가 실시간이라 캐시 안 함)
const friendResultCache = new Map(); // steamId -> { at, data } (60초 캐시)
app.get('/api/friends', requireAuth, async (req, res) => {
  const steamId = req.session.steamId;
  if (!API_KEY) return res.status(500).json({ error: 'STEAM_API_KEY 미설정' });
  const cache = cacheStore.loadCache(CACHE_DIR, steamId);
  if (!cache) return res.json({ games: [], friendCount: 0, reason: '먼저 동기화하세요.' });

  const cached = friendResultCache.get(steamId);
  if (cached && Date.now() - cached.at < 60 * 1000) return res.json(cached.data);

  try {
    const data = await buildFriendCoop(API_KEY, steamId, cache.games, CACHE_DIR);
    friendResultCache.set(steamId, { at: Date.now(), data });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 정적 프론트엔드
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`게임 디사이더 웹 → ${BASE_URL}`);
  if (!API_KEY) console.log('⚠️  .env 에 STEAM_API_KEY 가 없습니다.');
});
