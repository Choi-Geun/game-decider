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
const { buildGameDetail } = require('../src/gameDetail');
const { buildResume } = require('../src/resume');
const { buildCollection } = require('../src/collection');
const draw = require('../src/draw');
const store = require('../src/store');
const openid = require('./src/steamOpenId');

const env = loadEnv(path.join(__dirname, '..', '.env'));

// 회사망 SSL 검사 우회 (개발용)
if (env.INSECURE_TLS === '1') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const API_KEY = env.STEAM_API_KEY;
const PORT = Number(env.PORT || 3000);

// 배포 여부. Render 는 RENDER=true 와 서비스 URL 을 자동으로 넣어준다.
const IS_DEPLOYED = env.RENDER === 'true' || env.NODE_ENV === 'production';
// OpenID realm·return_to 에 그대로 쓰이므로 실제 접속 주소와 정확히 같아야 한다.
const BASE_URL = (env.BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// 데이터 경로. Render 영구 디스크를 붙였다면 DATA_DIR 로 그쪽을 가리킨다.
const DATA_DIR = env.DATA_DIR || __dirname;
const CACHE_DIR = path.join(DATA_DIR, '.cache');
const STATE_DIR = path.join(DATA_DIR, '.state');

// gd_auth 쿠키는 이 키로 SteamID 를 HMAC 서명한다. 키가 알려지면
// 누구나 남의 SteamID 로 서명된 쿠키를 만들어 그 사람 행세를 할 수 있다.
// 그래서 배포 환경에서는 기본값으로 뜨지 않고 죽는다.
const AUTH_SECRET = env.SESSION_SECRET || 'dev-secret-change-me';
if (IS_DEPLOYED && AUTH_SECRET === 'dev-secret-change-me') {
  console.error('❌ SESSION_SECRET 이 없습니다. 이 값 없이 배포하면 누구나 로그인 쿠키를 위조할 수 있습니다.');
  console.error('   Render → Environment 에 SESSION_SECRET 을 추가하세요 (임의의 긴 문자열).');
  process.exit(1);
}
const AUTH_COOKIE = 'gd_auth';
const AUTH_MAX_AGE = 1000 * 60 * 60 * 24 * 30; // 30일
// HTTPS 로 서비스될 때만 secure. 로컬 http 에서 켜면 쿠키가 아예 안 붙는다.
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: BASE_URL.startsWith('https://'),
  maxAge: AUTH_MAX_AGE,
  path: '/',
};

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
// Render 는 프록시 뒤에 있다. 이걸 켜야 req.protocol / secure 쿠키가 제대로 동작한다.
if (IS_DEPLOYED) app.set('trust proxy', 1);
app.use(express.json());
app.use(
  session({
    secret: AUTH_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7일
      httpOnly: true,
      sameSite: 'lax',
      secure: COOKIE_OPTS.secure,
    },
  })
);

// 헬스체크 — Render 가 기동 확인에 쓴다. 로그인 없이 응답해야 한다.
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

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
    res.cookie(AUTH_COOKIE, signId(steamId), COOKIE_OPTS);
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

// ── 개발 전용 로그인 ─────────────────────────────────────────────
// 디자인/테스트용. Steam OpenID를 거치지 않고 바로 로그인 상태를 만든다.
// 이중 게이트: ① .env 에 DEV_LOGIN_STEAMID 가 있어야 하고 ② 요청 호스트가 localhost 여야 한다.
// 배포 환경에는 DEV_LOGIN_STEAMID 를 넣지 말 것 (없으면 404로 존재 자체가 감춰짐).
const DEV_LOGIN_STEAMID = env.DEV_LOGIN_STEAMID;

// 삼중 게이트. 호스트 판정은 trust proxy 아래에서 X-Forwarded-Host 를 따라가므로
// 위조 여지가 있다 → 배포 환경이면 환경변수·호스트와 무관하게 통째로 막는다.
function isLocalRequest(req) {
  if (IS_DEPLOYED) return false;
  const host = (req.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

app.get('/dev/login', async (req, res) => {
  if (!DEV_LOGIN_STEAMID || !isLocalRequest(req)) return res.status(404).end();

  req.session.steamId = DEV_LOGIN_STEAMID;
  res.cookie(AUTH_COOKIE, signId(DEV_LOGIN_STEAMID), COOKIE_OPTS);
  if (!req.session.profile) {
    try {
      const p = await api.getPlayerSummary(API_KEY, DEV_LOGIN_STEAMID);
      if (p) req.session.profile = { name: p.personaname, avatar: p.avatarfull };
    } catch (_e) {}
  }
  res.redirect('/');
});

// /dev/login 과 대칭. 로그아웃 상태 화면(로그인 페이지)을 확인하려면 필요하다.
// 같은 이중 게이트 — 환경변수 + localhost.
app.get('/dev/logout', (req, res) => {
  if (!DEV_LOGIN_STEAMID || !isLocalRequest(req)) return res.status(404).end();
  res.clearCookie(AUTH_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: COOKIE_OPTS.secure });
  req.session.destroy(() => res.redirect('/'));
});

app.post('/auth/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: COOKIE_OPTS.secure });
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

// 이어하기 — 중도 이탈한 게임 + 지금 하던 것.
// 도전과제 unlockTime 으로 "어디서 멈췄는지"를 복원한다. 새 API 호출 없이 캐시만 쓴다.
app.get('/api/resume', requireAuth, (req, res) => {
  const cache = cacheStore.loadCache(CACHE_DIR, req.session.steamId);
  if (!cache) return res.json({ active: [], dropped: [], summary: {}, droppedTotal: 0 });
  const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 50);
  res.json(buildResume(cache, { limit }));
});

// ── 뽑기 루프 ────────────────────────────────────────────────────
// 카드 3장 → 1장 선택 → 나가서 플레이 → 돌아오면 판정.
// 판정은 별도 잡 없이 읽을 때마다 현재 캐시로 계산한다. 동기화는 이미
// 로그인 시·20분마다·탭 복귀 시 자동으로 돈다.

// 프론트에 내려줄 모양으로 정리
function drawPayload(state, justCompleted, now) {
  const cur = state.current || { cards: [], picked: null };
  return {
    cards: cur.cards || [],
    picked: cur.picked || null,
    drawnAt: cur.drawnAt || null,
    justCompleted: justCompleted || null,
    rerollAvailable: draw.rerollAvailable(state, now),
    stats: state.stats || { done: 0 },
    // 성공만 보여준다. 포기는 기록만 남기고 화면에 내지 않는다.
    recent: (state.history || []).filter((h) => h.status === 'done').slice(0, 8),
  };
}

// 캐시 없이는 뽑을 게 없다
function loadForDraw(req) {
  const steamId = req.session.steamId;
  const cache = cacheStore.loadCache(CACHE_DIR, steamId);
  return { steamId, cache };
}

app.get('/api/draw', requireAuth, (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const { steamId, cache } = loadForDraw(req);
  if (!cache) return res.json({ cards: [], picked: null, needsSync: true, stats: { done: 0 }, recent: [] });

  const before = store.loadState(STATE_DIR, steamId);
  const { state, justCompleted } = draw.advance(before, cache, { now });
  store.saveState(STATE_DIR, steamId, state);
  res.json(drawPayload(state, justCompleted, now));
});

app.post('/api/draw/pick', requireAuth, (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const { steamId, cache } = loadForDraw(req);
  if (!cache) return res.status(400).json({ error: 'no-cache' });

  const state = store.loadState(STATE_DIR, steamId);
  const r = draw.pick(state, Number(req.body && req.body.index), now);
  if (!r.ok) return res.status(409).json({ error: r.error });
  store.saveState(STATE_DIR, steamId, r.state);
  res.json(drawPayload(r.state, null, now));
});

app.post('/api/draw/reroll', requireAuth, (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const { steamId, cache } = loadForDraw(req);
  if (!cache) return res.status(400).json({ error: 'no-cache' });

  const r = draw.reroll(store.loadState(STATE_DIR, steamId), cache, { now });
  if (!r.ok) return res.status(409).json({ error: r.error });
  store.saveState(STATE_DIR, steamId, r.state);
  res.json(drawPayload(r.state, null, now));
});

app.post('/api/draw/giveup', requireAuth, (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const { steamId, cache } = loadForDraw(req);
  if (!cache) return res.status(400).json({ error: 'no-cache' });

  const r = draw.giveUp(store.loadState(STATE_DIR, steamId), cache, { now });
  if (!r.ok) return res.status(409).json({ error: r.error });
  store.saveState(STATE_DIR, steamId, r.state);
  res.json(drawPayload(r.state, null, now));
});

// 수집함 — 이미 딴 것 중 희귀한 것들. 캐시만 쓴다.
app.get('/api/collection', requireAuth, (req, res) => {
  const cache = cacheStore.loadCache(CACHE_DIR, req.session.steamId);
  if (!cache) return res.json({ counts: { total: 0 }, crown: null, showcase: [], nextTargets: [], harvest: { count: 0, items: [] } });
  res.json(buildCollection(cache));
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

// 게임 상세 (앱 정보/뉴스/평가/DLC + 내 진척도). 앱 정보는 TTL 캐싱.
app.get('/api/game/:appid', requireAuth, async (req, res) => {
  const appid = String(req.params.appid).replace(/\D/g, '');
  if (!appid) return res.status(400).json({ error: 'bad appid' });
  const lang = req.query.lang === 'en' ? 'english' : 'koreana';
  const cache = cacheStore.loadCache(CACHE_DIR, req.session.steamId);
  const game = cache && (cache.games || []).find((g) => g.appid === appid);

  let progress = null;
  if (game) {
    progress = {
      name: game.name, images: game.images,
      playtimeMinutes: game.playtimeMinutes, playtime2weeks: game.playtime2weeks, lastPlayed: game.lastPlayed,
      ach: game.ach || null,
    };
    if (game.ach && game.ach.hasAchievements) {
      const unlocked = game.ach.achievements.filter((a) => a.achieved && a.unlockTime).sort((a, b) => b.unlockTime - a.unlockTime);
      progress.lastAchievement = unlocked[0] || null;
    }
  }

  try {
    const detail = await buildGameDetail(appid, lang, CACHE_DIR, Date.now());
    res.json({ appid, progress, info: detail.info, news: detail.news, reviews: detail.reviews, dlc: detail.dlc, dlcTotal: detail.dlcTotal, cachedAt: detail.at });
  } catch (e) {
    res.json({ appid, progress, error: String(e.message || e) });
  }
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

// 0.0.0.0 바인딩 — Render 는 컨테이너 밖에서 접속하므로 localhost 로 묶으면 안 된다.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`게임 디사이더 웹 → ${BASE_URL}`);
  if (!API_KEY) console.log('⚠️  STEAM_API_KEY 가 없습니다. 게임/도전과제 조회가 전부 실패합니다.');
  if (IS_DEPLOYED && !env.BASE_URL && !env.RENDER_EXTERNAL_URL) {
    console.log('⚠️  BASE_URL 을 못 찾았습니다. Steam 로그인 후 localhost 로 되돌아가 실패합니다.');
  }
});
