// ── 유틸 ──────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const steamRunUrl = (appid) => `steam://run/${appid}`;
const imgHeader = (g) => (g.images && g.images.header) || `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`;
const imgPortrait = (g) => (g.images && g.images.portrait) || `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/library_600x900.jpg`;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fmtDate(unix) {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── 로딩 표시 ─────────────────────────────────────────────────────
// 스켈레톤을 기본으로 쓴다. 스피너 하나만 돌리면 뭐가 올지 모르고, 다 받은 뒤
// 레이아웃이 튄다. 올 모양을 미리 그려두면 기다림이 짧게 느껴지고 튐도 없다.
const rep = (n, s) => Array.from({ length: n }, () => s).join('');
const skelLines = (ws) => ws.map((w) => `<div class="skel skel-line ${w}"></div>`).join('');

// 그리드형(내 게임·트로피·친구) — 카드 n장
function skelGrid(n, cls) {
  return `<div class="${cls}">${rep(n, `<div class="skel-card"><div class="skel skel-art"></div>
    <div class="skel-body">${skelLines(['w70', 'w45'])}</div></div>`)}</div>`;
}
// 가로로 긴 행형(이어하기)
function skelRows(n) {
  return rep(n, `<div class="skel-row"><div class="skel skel-cover"></div>
    <div class="skel-rest">${skelLines(['w45', 'w90', 'w70'])}</div></div>`);
}
// 오늘의 도전 3장
function skelDeck() {
  return `<div class="skel-deck">${rep(3, `<div class="skel-card"><div class="skel skel-art"></div>
    <div class="skel-body">${skelLines(['w45', 'w90', 'w70'])}</div></div>`)}</div>`;
}
// 첫 동기화 중 화면. 몇 분 걸리므로 "얼마나 왔는지"가 보여야 기다릴 수 있다.
// 진행 텍스트는 pollProgress 가 #syncPanelText 에 채운다.
function syncingPanel() {
  return `<div class="sync-panel">
    <div class="gd-spinner"></div>
    <h3>${esc(t('syncPanelTitle'))}</h3>
    <p id="syncPanelText">${esc(t('syncChecking'))}</p>
    <p class="sp-note">${esc(t('needSyncDesc'))}</p>
  </div>${skelDeck()}`;
}

// 모양을 미리 알 수 없는 짧은 대기에만
function loadNote(msg) {
  return `<div class="load-note"><span class="gd-spinner"></span>${esc(msg || t('loading'))}</div>`;
}

// 날짜 + 시각. Steam 은 초 단위 unix 를 주므로 분까지만 쓴다.
// "언제 했더라"에는 날짜만으론 부족하고, 초까지는 아무도 안 본다.
function fmtDateTime(unix) {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  return `${fmtDate(unix)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── 커버 이미지 폴백 ──────────────────────────────────────────────
// 이미지 URL은 appid로 조립할 뿐 검증하지 않는다. 미출시·베타 타이틀은 Steam CDN에
// 아트가 아예 없어서(portrait/header 모두 404) 그냥 두면 빈칸이 남는다.
// 로드 실패 시 게임명을 보여주는 카드로 대체한다.
//
// 사용법: <img data-fallback="게임명" data-alt="차선책 URL"> — data-alt 이 있으면
// 먼저 그쪽으로 한 번 재시도하고, 그것도 실패하면 폴백 카드로 바꾼다.
function coverAttrs(g, altUrl) {
  return `data-fallback="${esc(g.name)}"${altUrl ? ` data-alt="${esc(altUrl)}"` : ''}`;
}
function coverFallbackEl(name, className) {
  const el = document.createElement('div');
  el.className = ['cover-fallback', className].filter(Boolean).join(' ');
  const glyph = document.createElement('span');
  glyph.className = 'covf-glyph';
  glyph.textContent = '🎮';
  const title = document.createElement('span');
  title.className = 'covf-title';
  title.textContent = name || '';
  el.append(glyph, title);
  el.title = name || '';
  return el;
}
// error 이벤트는 버블링하지 않으므로 캡처 단계에서 문서 전체를 한 번에 처리한다.
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || img.dataset.fallback == null) return;
    if (img.dataset.alt) {
      const next = img.dataset.alt;
      delete img.dataset.alt; // 재시도는 한 번만
      img.src = next;
      return;
    }
    img.replaceWith(coverFallbackEl(img.dataset.fallback, img.className));
  },
  true
);

// gameSort 기본값이 '최근 플레이 순'인 이유: 라이브러리를 열 때 찾는 건
// 보통 "요즘 뭐 하고 있었지"다. 총 플레이 시간 1위는 몇 년 전에 끝난 게임일 수 있다.
let syncSilent = false, syncFailed = false;
const state = { me: null, games: [], achievementsBlocked: false, view: 'spin', achGroup: 'collected', lastPick: null, didInitialSpin: false, gameSort: 'recent', collTier: 'all' };

// ── 언어 전환 ─────────────────────────────────────────────────────
document.querySelectorAll('.lang-switch button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
window.onLangChange = () => {
  renderProfile();
  syncTopbar(); // 상단바 제목도 새 언어로
  renderView();
  if (state.detailAppid) openDetail(state.detailAppid); // 새 언어로 상세 재조회
  if (state.lastPick) showPick(state.lastPick); // 이유/제안 문구 새 언어로
};

// ── 로그인 ────────────────────────────────────────────────────────
let loginWin = null, loginPoll = null;
$('login').addEventListener('click', () => {
  const w = 800, h = 700;
  const left = window.screenX + (window.outerWidth - w) / 2;
  const top = window.screenY + (window.outerHeight - h) / 2;
  loginWin = window.open('/auth/steam', 'steamLogin', `width=${w},height=${h},left=${left},top=${top}`);
  if (!loginWin) { location.href = '/auth/steam'; return; }
  $('login').disabled = true;
  $('login').querySelector('[data-i18n]').textContent = t('loginChecking');
  clearInterval(loginPoll);
  loginPoll = setInterval(async () => {
    let me;
    try { me = await fetch('/api/me').then((r) => r.json()); } catch (e) { return; }
    if (me.loggedIn) { clearInterval(loginPoll); if (loginWin && !loginWin.closed) loginWin.close(); refreshMe(); }
    else if (loginWin && loginWin.closed) { clearInterval(loginPoll); $('login').disabled = false; applyI18n(); }
  }, 1200);
});
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'steam-login' && e.data.success) {
    if (loginWin && !loginWin.closed) loginWin.close();
    refreshMe();
  }
});
$('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.reload(); });

// ── 로그인 상태 / 프로필 ──────────────────────────────────────────
async function refreshMe() {
  let me;
  // 실패해도 반드시 둘 중 하나는 열어야 한다. 그냥 return 하면 흰 화면이 남는다.
  try { me = await fetch('/api/me').then((r) => r.json()); } catch (e) { me = { loggedIn: false }; }
  state.me = me;
  // 스플래시는 성패와 무관하게 반드시 걷는다 — 남으면 앱 전체가 가려진다
  const boot = $('boot');
  if (boot) boot.remove();
  if (!me.loggedIn) {
    $('loginScreen').classList.remove('hidden');
    $('app').classList.add('hidden');
    return;
  }
  $('loginScreen').classList.add('hidden');
  $('app').classList.remove('hidden');
  renderProfile();
  applyRoute(); // 해시로 초기 뷰 결정 (새로고침·딥링크 유지)
  await loadGames();
  if (!autoSetup) {
    autoSetup = true;
    // 새로고침할 때마다 동기화하면 매번 40초를 기다리고 Steam API 도 그만큼 때린다.
    // 캐시가 없을 때만 즉시 받고, 있으면 낡았을 때만 갱신한다.
    if (syncIsStale()) startSync(false, true);
    setInterval(() => { if (syncIsStale()) startSync(false, true); }, 20 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && syncIsStale()) startSync(false, true);
    });
  }
}

// 캐시가 아예 없으면 무조건 받아야 한다. 있으면 이 시간이 지나야 다시 받는다.
const SYNC_TTL_SEC = 6 * 60 * 60;
function syncIsStale() {
  const me = state.me;
  if (!me || !me.loggedIn) return false;
  if (!me.hasCache || !me.updatedAt) return true;
  return Math.floor(Date.now() / 1000) - me.updatedAt > SYNC_TTL_SEC;
}

function renderProfile() {
  const me = state.me;
  if (!me || !me.loggedIn) return;
  if (me.profile) { $('avatar').src = me.profile.avatar || ''; $('pname').textContent = me.profile.name || me.steamId; }
  else $('pname').textContent = me.steamId;
  $('synced').textContent = me.updatedAt ? t('syncedAt', { date: fmtDate(me.updatedAt), n: me.count || 0 }) : t('notSynced');
  $('synced').title = t('syncNowHint');
  updateSyncAffordance();
}

async function loadGames() {
  try {
    const d = await fetch('/api/games').then((r) => r.json());
    state.games = d.games || [];
    state.achievementsBlocked = !!d.achievementsBlocked;
    // 무효화는 '다시 동기화된 경우'에만. 최초 로드에서 지우면 방금 받은 데이터를
    // 버리고 다시 받게 되어 화면이 두 번 그려진다(카드가 두 번 회전했다).
    if (gamesLoadedOnce) {
      resumeData = null; // 동기화로 진행도가 바뀌었을 수 있으니 다시 계산시킨다
      collectionData = null;
      dailyData = null;  // 동기화가 곧 판정이다 — 고른 도전이 깨졌는지 여기서 드러난다
      // 상세도 지운다. 안 지우면 동기화 전에 progress:null 로 받은 응답이 세션 내내
      // 재사용돼서, "동기화하기"를 눌러 실제로 받아와도 화면이 그대로 비어 있다.
      for (const k of Object.keys(detailCache)) delete detailCache[k];
    }
    gamesLoadedOnce = true;
  } catch (e) {}
  renderView();
  // 최초 1회만 자동 스핀 (동기화 후 재호출돼도 다시 안 돎)
  if (state.view === 'spin' && state.games.length && !state.didInitialSpin) {
    state.didInitialSpin = true;
    spin();
  }
}

// ── 동기화 ────────────────────────────────────────────────────────
let syncing = false, autoSetup = false, gamesLoadedOnce = false;
// 동기화 버튼은 '필요할 때만' 보인다. 늘 떠 있으면 뭔가 잘못된 것처럼 읽히고,
// 실제로는 대부분의 방문에서 누를 일이 없다.
// 다만 조용히 감추기만 하면 강제 동기화 수단이 사라지므로,
// 프로필의 '동기화됨 …' 줄을 눌러 언제든 돌릴 수 있게 남겨둔다.
// 캐시가 없거나 실패했다 = 사용자가 손을 써야 한다. 모바일 상단바의 알림 점도
// 같은 조건을 봐야 한다 — 따로 쓰면 한쪽이 반드시 어긋난다.
function syncNeedsAttention() {
  const me = state.me;
  return !me || !me.loggedIn ? false : (!me.hasCache || syncFailed);
}
function updateSyncAffordance() {
  const needs = syncNeedsAttention();
  const btn = $('sync');
  if (btn) btn.classList.toggle('hidden', !(needs || syncing && !syncSilent));
  syncTopbar(); // 아바타·알림 점도 같이 (모바일)
}

function setSyncing(on) {
  syncing = on;
  const btn = $('sync');
  btn.disabled = on;
  btn.classList.toggle('is-syncing', on);
  btn.textContent = on ? t('syncing') : t('sync');
  // syncing 이 바뀌면 '동기화 중에는 버튼을 보여준다' 조건도 다시 봐야 한다.
  // 안 부르면 그 분기가 영원히 렌더되지 않는다(캐시가 있는 유저는 버튼이 계속 숨어 있었다).
  updateSyncAffordance();
}

// 실패 종료는 반드시 여기로 모은다. 전에는 네 곳에서 제각각 끝냈고, 그중
// 한 곳은 정의되지 않은 함수(syncFailedWith)를 불러 ReferenceError 를 던졌다.
// 그러면 setSyncing(false) 에 못 가서 syncing 이 영구히 true 로 남고,
// 동기화 버튼·'지금 확인'이 전부 먹통이 되며 "동기화 중…" 가짜 화면이 고정됐다.
function syncFailedWith(msg) {
  syncFailed = true; // 상단바 알림 점·동기화 버튼이 이 값을 본다
  $('progress').classList.remove('hidden');
  $('progress').textContent = msg || t('syncFail');
  setSyncing(false); // updateSyncAffordance 까지 여기서 이어진다
}

async function startSync(full, silent) {
  if (syncing) return;
  // 자동 동기화(주기·탭 복귀)는 조용해야 한다. 인자를 안 받던 탓에 호출부가 넘기던
  // silent 가 버려져서, 20분마다 진행 텍스트가 뜨고 버튼이 비활성화됐다.
  syncSilent = !!silent;
  syncFailed = false; // 재시도하면 이전 실패 표시는 지운다
  setSyncing(true);
  $('progress').classList.toggle('hidden', syncSilent);
  if (!syncSilent) $('progress').textContent = full ? t('syncFull') : t('syncChecking');
  try {
    const r = await fetch('/api/sync' + (full ? '?full=1' : ''), { method: 'POST' }).then((x) => x.json());
    if (r.error) return syncFailedWith('❌ ' + r.error);
    pollProgress();
  } catch (e) { syncFailedWith(t('syncFail')); }
}
async function pollProgress() {
  let p;
  // 폴링이 끊긴 것도 실패다. 전에는 조용히 setSyncing(false) 만 해서
  // 사용자에게 아무 표시도 남지 않았다.
  try { p = await fetch('/api/sync/progress').then((r) => r.json()); } catch (e) { return syncFailedWith(t('syncFail')); }
  if (p.status === 'running') {
    const msg = p.total ? t('syncProgress', { done: p.done, total: p.total, name: p.name || '' }) : t('syncChecking');
    if (!syncSilent) $('progress').textContent = msg;
    const panel = document.getElementById('syncPanelText');
    if (panel) panel.textContent = msg;
    setTimeout(pollProgress, 1000);
  } else if (p.status === 'done') {
    const s = p.stats || {};
    let msg = s.fetched ? t('syncUpdated', { n: s.fetched }) : t('syncLatest');
    if (s.added) msg += ' · ' + t('syncNewGames', { n: s.added });
    if (!syncSilent) $('progress').textContent = msg;
    setSyncing(false);
    refreshMeLight();
    loadGames();
    if (!s.fetched) setTimeout(() => $('progress').classList.add('hidden'), 2500);
  } else if (p.status === 'error') { syncFailedWith('❌ ' + (p.error || '')); }
  else setSyncing(false);
}
async function refreshMeLight() {
  let me;
  try { me = await fetch('/api/me').then((r) => r.json()); } catch (e) { return; }
  // 세션이 만료됐는데 그대로 갈아끼우면 renderProfile 이 첫 줄에서 되돌아가
  // 프로필·알림 점이 낡은 채로 남고, 로그인 화면도 안 뜬 채 옛 데이터가 계속 보인다.
  // 로그아웃 상태로 바뀌었으면 전체 경로로 넘겨 로그인 화면을 띄운다.
  if (!me.loggedIn) { state.me = me; refreshMe(); return; }
  state.me = me;
  renderProfile();
}
$('sync').addEventListener('click', () => startSync(false));
$('synced').addEventListener('click', () => startSync(false));

// ── 네비게이션 (해시 라우팅) ──────────────────────────────────────
// URL 해시가 곧 현재 뷰. 새로고침해도 뷰가 유지되고, 특정 화면을 링크로 공유할 수 있다.
//   #spin | #games | #games/{appid} | #ach | #ach/{subtab} | #friends
// 'spin' 은 LNB 에서 뺐지만 라우트는 남겨둔다 — '오늘의 도전'과 목적이 겹쳐
// 메뉴에 둘 다 두면 '뭘 눌러야 하지'가 생긴다. #spin 으로는 여전히 열린다.
const VIEWS = ['daily', 'spin', 'resume', 'games', 'ach', 'friends'];
const ACH_TABS = ['collected', 'targets', 'game'];

function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const [view, param] = raw.split('/');
  return { view: VIEWS.includes(view) ? view : 'daily', param: param || null };
}

// 뷰 전환의 단일 진입점 — 해시가 바뀔 때만 호출된다.
function applyRoute() {
  const { view, param } = parseHash();
  state.view = view;

  // 활성 표시는 클래스(색·막대)만으로는 안 보이는 사람에게 전달되지 않는다.
  // 모바일에서 탭바가 유일한 내비게이션이라 '지금 어디' 정보가 통째로 사라진다.
  document.querySelectorAll('.nav-item').forEach((x) => {
    const on = x.dataset.view === view;
    x.classList.toggle('active', on);
    if (on) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current');
  });
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('view-' + view).classList.remove('hidden');

  // 서브탭도 URL 로. 링크로 공유되고 새로고침해도 유지된다.
  if (view === 'ach') {
    state.achGroup = ACH_TABS.includes(param) ? param : 'collected';
    document.querySelectorAll('.subtab').forEach((x) => x.classList.toggle('active', x.dataset.group === state.achGroup));
  }
  if (view === 'games') {
    const appid = param ? Number(param) : null;
    if (appid) { if (state.detailAppid !== appid) openDetail(appid); }
    else closeDetail();
  }
  syncTopbar(); // 모바일 상단바 제목 = 현재 화면 이름
  renderView();

  // 스핀 탭으로 처음 왔는데 아직 한 번도 안 돌았으면 1회 스핀
  if (view === 'spin' && state.games.length && !state.didInitialSpin) {
    state.didInitialSpin = true;
    spin();
  } else if (view === 'spin' && state.lastPick) {
    layoutStatic();
  }
}

function navigate(hash) {
  const next = '#' + hash;
  if (location.hash === next) applyRoute(); // 같은 해시 재클릭 → hashchange 안 뜨므로 직접 호출
  else location.hash = next;
}

document.querySelectorAll('.nav-item').forEach((b) =>
  b.addEventListener('click', () => navigate(b.dataset.view))
);
window.addEventListener('hashchange', applyRoute);

function renderView() {
  if (state.view === 'daily') renderDaily();
  else if (state.view === 'resume') renderResume();
  else if (state.view === 'games') renderGames();
  else if (state.view === 'ach') renderAch();
  else if (state.view === 'friends') renderFriendsIfLoaded();
  // 페이드 재적용은 MutationObserver(queueFades)가 맡는다 — 렌더 경로마다 심지 않는다
}

// ── 이유 문구 생성기 (게임 상태 기반, 다양하게) ───────────────────
function seededPick(arr, appid) {
  let h = 0; const s = String(appid);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}
function reasonFor(g) {
  const pt = g.playtimeMinutes || 0;
  const w = g.playtime2weeks || 0;
  const ach = g.ach && g.ach.hasAchievements ? g.ach : null;
  const pct = ach ? ach.completionPct : null;
  const locked = ach ? ach.achievements.filter((a) => !a.achieved && a.globalPercent != null) : [];
  const rare = locked.length ? Math.min(...locked.map((a) => a.globalPercent)) : null;
  const easyLeft = locked.filter((a) => a.globalPercent >= 50).length;
  const vars = { h: Math.round(pt / 60), w, pct, u: ach ? ach.unlocked : 0, t: ach ? ach.total : 0, rare: rare != null ? rare.toFixed(1) : '', left: easyLeft };

  let key;
  if (pt === 0) key = 'never';
  else if (pt < 60) key = 'backlog';
  else if (pct === 100) key = 'completed';
  else if (pct != null && pct >= 80) key = 'almost';
  else if (rare != null && rare <= 5) key = 'rare';
  else if (w > 0) key = 'recent';
  else if (pct != null && pct >= 40) key = 'halfway';
  else if (easyLeft > 0) key = 'easy';
  else if (pt >= 6000) key = 'favorite';
  else key = 'default';

  const pool = (REASONS[LANG] && REASONS[LANG][key]) || REASONS.ko[key] || REASONS.ko.default;
  let s = seededPick(pool, g.appid + key);
  for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

// 다음에 할 콘텐츠 제안 (도전과제/진척도 기반)
function suggestFor(g) {
  const ach = g.ach && g.ach.hasAchievements ? g.ach : null;
  if (!ach || !ach.total) return (g.playtimeMinutes || 0) === 0 ? tSuggest('start') : '';
  if (ach.completionPct === 100) return tSuggest('done');
  const locked = ach.achievements.filter((a) => !a.achieved);
  const known = locked.filter((a) => a.globalPercent != null);
  if (!locked.length) return '';
  const rare = known.slice().sort((a, b) => a.globalPercent - b.globalPercent)[0];
  const easy = known.slice().sort((a, b) => b.globalPercent - a.globalPercent)[0];
  if (rare && rare.globalPercent <= 5) return tSuggest('rare', { ach: rare.name, pct: rare.globalPercent.toFixed(1) });
  if (easy && easy.globalPercent >= 50) return tSuggest('easy', { ach: easy.name, pct: Math.round(easy.globalPercent) });
  if (ach.completionPct >= 80) return tSuggest('finish', { left: locked.length });
  if (easy) return tSuggest('next', { ach: easy.name });
  return tSuggest('generic', { left: locked.length });
}
function tSuggest(key, vars) {
  const pool = (SUGGEST[LANG] && SUGGEST[LANG][key]) || SUGGEST.ko[key] || [''];
  let s = pool[0];
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

// ── 3D 커버플로우 슬롯 (주크박스식) ───────────────────────────────
let deck = [], cardEls = [], animId = null, landIndex = 0, curFocus = 0;
function cardSpacing() {
  const w = cardEls[0] ? cardEls[0].offsetWidth : 240;
  return Math.max(120, w * 0.72);
}
// position: 현재 중앙 위치(실수). focus: 0=스핀중(원래크기), 1=착지(확대)
function layout(position, focus) {
  focus = focus || 0;
  const spacing = cardSpacing();
  for (let i = 0; i < cardEls.length; i++) {
    const el = cardEls[i];
    const d = i - position;
    const ad = Math.abs(d);
    if (ad > 1.6) { el.style.visibility = 'hidden'; continue; } // 좌우 1장만 노출
    el.style.visibility = 'visible';
    const clamp = Math.max(-1, Math.min(1, d));
    const x = d * spacing;
    const z = -ad * 300;
    const ry = -clamp * 50;
    const scale = ad < 0.5 ? 1 + focus * 0.16 : 0.72 - (ad - 0.5) * 0.12;
    el.style.transform = `translate(-50%,-50%) translateX(${x}px) translateZ(${z}px) rotateY(${ry}deg) scale(${scale})`;
    el.style.zIndex = String(200 - Math.round(ad * 10));
    el.style.opacity = ad > 1.5 ? '0' : '1';
    el.classList.toggle('center', ad < 0.5);
  }
}
function layoutStatic() { if (cardEls.length) layout(landIndex, curFocus); }
function renderDeck() {
  const cf = $('coverflow');
  cf.innerHTML = deck.map((g) => `<div class="cf-card"><img src="${imgPortrait(g)}" ${coverAttrs(g, imgHeader(g))}></div>`).join('');
  cardEls = Array.from(cf.children);
}
function showPick(g) {
  if (!g) { $('pickName').textContent = ''; $('pickReason').textContent = t('spinNeedGames'); $('pickHint').textContent = ''; $('pick').classList.add('show'); return; }
  state.lastPick = g;
  $('pickName').textContent = g.name;
  $('pickReason').textContent = reasonFor(g);
  $('pickHint').textContent = suggestFor(g);
  $('pickPlay').href = steamRunUrl(g.appid);
  $('pick').classList.add('show');
}
function animateFocus(to, dur, after) {
  const from = curFocus, t0 = performance.now();
  const e = (x) => 1 - Math.pow(1 - x, 3);
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    curFocus = from + (to - from) * e(p);
    layout(landIndex, curFocus);
    if (p < 1) requestAnimationFrame(step); else if (after) after();
  };
  requestAnimationFrame(step);
}
function spin() {
  if (!state.games.length) { showPick(null); return; }
  const rand = () => state.games[Math.floor(Math.random() * state.games.length)];
  const chosen = rand();
  const LEN = 30; landIndex = 24;
  deck = [];
  for (let i = 0; i < LEN; i++) deck.push(i === landIndex ? chosen : rand());
  renderDeck();
  curFocus = 0;
  layout(0, 0);
  $('reroll').disabled = true;
  $('pick').classList.remove('show');
  const dur = 4600, t0 = performance.now();
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  cancelAnimationFrame(animId);
  const frame = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    layout(landIndex * ease(p), 0);
    if (p < 1) animId = requestAnimationFrame(frame);
    else { $('reroll').disabled = false; showPick(chosen); animateFocus(1, 400); }
  };
  animId = requestAnimationFrame(frame);
}
// 리롤: 확대돼 있던 선택 게임을 원래 크기로 축소한 뒤 스핀
function doReroll() {
  if (state.lastPick && curFocus > 0.01 && cardEls.length) animateFocus(0, 260, spin);
  else spin();
}
$('reroll').addEventListener('click', doReroll);
window.addEventListener('resize', () => { if (state.view === 'spin' && cardEls.length && !$('reroll').disabled) layoutStatic(); });

// ── 내 게임 ───────────────────────────────────────────────────────
// 정렬 기준. '없음'(플레이 0·미달성)은 어느 방향이든 뒤로 보낸다 —
// 오름차순에서 안 켠 게임 수십 개가 앞을 다 막으면 정렬한 의미가 없다.
// dir: 1 오름차순, -1 내림차순. **인자 순서는 항상 (a, b)** — 뒤집어 넘기면
// null 처리까지 같이 뒤집혀서 "값 없음"이 맨 앞으로 온다(실제로 한 번 그랬다).
function nullLast(x, y, dir) {
  if (x == null && y == null) return 0;
  if (x == null) return 1;   // 값 없는 쪽은 방향과 무관하게 항상 뒤로
  if (y == null) return -1;
  return dir > 0 ? x - y : y - x;
}
// 0% 는 '없음'이 아니라 실제 값이다 — 도전과제가 아예 없는 게임만 null.
const pctOf = (g) => (g.ach && g.ach.hasAchievements ? g.ach.completionPct : null);
// 플레이 0분은 '안 켬'이라 뒤로 보낸다.
const playOf = (g) => (g.playtimeMinutes ? g.playtimeMinutes : null);

// 플레이 시간 정렬은 뺐다 — 라이브러리를 훑는 목적에는 '언제 했나'와
// '얼마나 깼나'면 충분하고, 축이 많을수록 고르기만 어려워진다.
const GAME_SORTS = {
  recent: (a, b) => nullLast(a.lastPlayed || null, b.lastPlayed || null, -1),
  oldest: (a, b) => nullLast(a.lastPlayed || null, b.lastPlayed || null, 1),
  'ach-desc': (a, b) => nullLast(pctOf(a), pctOf(b), -1),
  'ach-asc': (a, b) => nullLast(pctOf(a), pctOf(b), 1),
};

function renderGames() {
  // 아직 못 받았을 뿐인데 "게임이 없어요"라고 하면 거짓말이다.
  if (!gamesLoadedOnce) { $('gameGrid').innerHTML = skelGrid(8, 'game-grid'); return; }
  const q = ($('gameSearch').value || '').toLowerCase();
  const key = GAME_SORTS[state.gameSort] ? state.gameSort : 'recent';
  const list = state.games
    .filter((g) => g.name.toLowerCase().includes(q))
    .slice()
    .sort(GAME_SORTS[key]);
  $('gameGrid').innerHTML = list.map((g) => {
    const pct = pctOf(g);
    // 1시간 미만을 "0시간"으로 쓰면 안 켠 것처럼 보인다 — 그건 분으로 말한다
    const hours = !g.playtimeMinutes ? ''
      : g.playtimeMinutes < 60 ? g.playtimeMinutes + t('minutes')
      : Math.round(g.playtimeMinutes / 60) + t('hours');
    // 정렬 기준과 무관하게 둘 다 항상 보여준다. 정렬을 바꿀 때마다 값이
    // 갈아끼워지면 두 게임을 비교할 수가 없다.
    const line1 = [
      pct != null ? t('completion', { pct }) : t('dNoAchShort'),
      hours,
    ].filter(Boolean).join(' · ');
    const line2 = g.lastPlayed
      ? `${t('dLastPlayed')} ${fmtDateTime(g.lastPlayed)}`
      : t('dNever');
    const bar = pct != null ? `<div class="bar"><i style="width:${pct}%"></i></div>` : '';
    return `<div class="game-card" data-appid="${g.appid}"><img src="${imgHeader(g)}" ${coverAttrs(g)}>
      <div class="gc-body"><div class="gc-name" title="${esc(g.name)}">${esc(g.name)}</div>
        <div class="gc-meta">${line1}</div>${bar}
        <div class="gc-when">${line2}</div></div></div>`;
  }).join('') || `<div class="empty">${t('emptyGroup')}</div>`;
}
$('gameSearch').addEventListener('input', renderGames);
$('gameSort').addEventListener('click', (e) => {
  const b = e.target.closest('.sort-btn');
  if (!b) return;
  state.gameSort = b.dataset.sort;
  $('gameSort').querySelectorAll('.sort-btn').forEach((x) =>
    x.classList.toggle('active', x === b));
  renderGames();
});
$('gameGrid').addEventListener('click', (e) => {
  const card = e.target.closest('.game-card');
  if (card && card.dataset.appid) navigate('games/' + card.dataset.appid);
});

// ── 이어하기 ──────────────────────────────────────────────────────
// 돌아오는 걸 막는 건 의욕이 아니라 "내가 어디까지 했더라"다.
// 마지막으로 깬 것 + 다음 지점을 보여주면 재진입 비용이 사라진다.
let resumeData = null, resumeLoading = false;

// "3개월 방치"가 아니라 "3개월 전" — 사실은 같지만 죄책감 주는 도구는 안 열게 된다.
function agoText(days) {
  if (days == null) return '';
  if (days < 45) return t('agoDays', { n: days });
  if (days < 365) return t('agoMonths', { n: Math.round(days / 30) });
  return t('agoYears', { n: Math.floor(days / 365) });
}

async function loadResume() {
  if (resumeLoading) return;
  resumeLoading = true;
  try { resumeData = await fetch('/api/resume').then((r) => r.json()); }
  catch (e) { resumeData = { active: [], dropped: [], droppedTotal: 0 }; }
  resumeLoading = false;
  if (state.view === 'resume') renderResume();
}

// 달성 시각 눈금. 진행 바와 축이 다르므로(하나는 진행률, 하나는 시간)
// 절대 겹쳐 그리지 않는다 — 33%짜리 게임의 눈금이 100% 폭에 퍼져 보이면 거짓말이 된다.
function timelineHtml(points) {
  if (!points || points.length < 2) return '';
  const ticks = points.map((p) => `<i style="left:${(p * 100).toFixed(1)}%"></i>`).join('');
  return `<div class="rc-timeline" aria-hidden="true">${ticks}</div>`;
}

function resumeCardHtml(c, isActive) {
  const when = isActive && c.recentMinutes
    ? t('resumeRecent', { h: Math.max(1, Math.round(c.recentMinutes / 60)) })
    : t('resumeStopped', { when: agoText(c.dormantDays) });

  const cover = `<img class="rc-cover" src="${imgHeader(c)}" ${coverAttrs(c)}>`;

  // 라벨을 값 옆에 두면 값이 쓸 폭이 그만큼 줄어 이름이 거의 다 잘렸다.
  // 라벨은 위로 올리고 값은 두 줄까지. 그래도 넘치면 title 로 전문을 보여준다.
  // '마지막 플레이' 는 실제 실행 시각(lastPlayed)으로 말한다. 도전과제 unlockTime 은
  // "깬 시각"이라 안 깨고 논 세션이 빠진다 — 라벨과 값이 어긋나면 그게 거짓말이 된다.
  const lastAt = c.lastPlayed || (c.lastAchievement && c.lastAchievement.unlockTime) || null;
  const last = lastAt
    ? `<div class="rc-row">
         <div class="rc-rowhead"><span class="rc-label">${t('resumeLastAch')}</span>
           <span class="rc-date">${fmtDateTime(lastAt)}</span></div>
         ${c.lastAchievement
           ? `<div class="rc-ach" title="${esc(c.lastAchievement.name)}">🏅 ${esc(c.lastAchievement.name)}</div>`
           : ''}
       </div>`
    : '';

  const next = c.nextAchievement
    ? `<div class="rc-row rc-next">
         <div class="rc-rowhead"><span class="rc-label">${t('resumeNextAch')}</span>
           <span class="rc-date">${t('resumePlayers', { p: Math.round(c.nextAchievement.globalPercent) })}</span></div>
         <div class="rc-ach" title="${esc(c.nextAchievement.name)}">${esc(c.nextAchievement.name)}</div>
         ${c.nextAchievement.description ? `<div class="rc-sub" title="${esc(c.nextAchievement.description)}">${esc(c.nextAchievement.description)}</div>` : ''}
       </div>`
    : '';

  const notes = [];
  if (c.burstCount >= 3) notes.push(t('resumeReturns', { n: c.burstCount }));
  if (c.unlockPaceMinutes != null) notes.push(t('resumePace', { m: c.unlockPaceMinutes }));

  return `<article class="resume-card" data-appid="${c.appid}">
    ${cover}
    <div class="rc-body">
      <div class="rc-head">
        <h3 class="rc-name" title="${esc(c.name)}">${esc(c.name)}</h3>
        <span class="rc-when">${when}</span>
      </div>
      <div class="rc-bar"><div class="rc-fill" style="width:${c.completionPct}%"></div></div>
      ${timelineHtml(c.timeline)}
      <div class="rc-prog">${t('resumeProgress', { u: c.unlocked, t: c.total, p: c.completionPct })}</div>
      ${last}${next}
      ${notes.length ? `<div class="rc-notes">${notes.map(esc).join(' · ')}</div>` : ''}
      <a class="rc-play" href="${steamRunUrl(c.appid)}">▶ ${t('resumeBtn')}</a>
    </div>
  </article>`;
}

function renderResume() {
  const box = $('resumeContent');
  if (!box) return;
  if (!resumeData) { box.innerHTML = skelRows(3); loadResume(); return; }

  const { active = [], dropped = [], droppedTotal = 0 } = resumeData;
  if (!active.length && !dropped.length) {
    box.innerHTML = emptyState(t('resumeEmptyTitle'), t('resumeEmpty'),
      `<a class="es-btn" href="#daily">${t('goDaily')}</a>`);
    return;
  }

  let html = '';
  if (active.length) {
    html += `<section class="resume-group">
      <h3 class="rg-title">${t('resumeActive')}</h3>
      <p class="rg-sub">${t('resumeActiveSub')}</p>
      <div class="resume-list">${active.map((c) => resumeCardHtml(c, true)).join('')}</div></section>`;
  }
  if (dropped.length) {
    const more = droppedTotal > dropped.length
      ? `<span class="rg-count">${t('resumeMore', { m: dropped.length, n: droppedTotal })}</span>` : '';
    html += `<section class="resume-group"><h3 class="rg-title">${t('resumeDropped')}${more}</h3>
      <div class="resume-list">${dropped.map((c) => resumeCardHtml(c, false)).join('')}</div></section>`;
  }
  box.innerHTML = html;
}

// 카드의 커버/제목을 누르면 상세로. 실행 링크는 그대로 통과시킨다.
$('resumeContent').addEventListener('click', (e) => {
  if (e.target.closest('.rc-play')) return;
  const card = e.target.closest('.resume-card');
  if (card && card.dataset.appid) navigate('games/' + card.dataset.appid);
});

// 빈 상태는 '없다'로 끝내지 않는다. 왜 비었는지와 다음에 할 일을 같이 준다.
function emptyState(title, desc, action) {
  return `<div class="empty-state">
    <div class="es-title">${title}</div>
    ${desc ? `<div class="es-desc">${desc}</div>` : ''}
    ${action ? `<div class="es-action">${action}</div>` : ''}
  </div>`;
}

// ── 오늘의 도전 (뽑기 루프) ───────────────────────────────────────
// 읽고 끝나는 화면이 아니라, 미해결 상태를 하나 안고 나가게 만드는 장치.
// 세 장 중 하나만 고를 수 있다 — 버린 두 장이 아까워야 고른 하나에 무게가 생긴다.
let dailyData = null, dailyBusy = false;

async function loadDaily(force) {
  if (dailyBusy) return;
  if (dailyData && !force) return;
  dailyBusy = true;
  try { dailyData = await fetch('/api/draw').then((r) => r.json()); }
  catch (e) { dailyData = null; }
  dailyBusy = false;
  if (state.view === 'daily') renderDaily();
}

async function dailyAction(pathname, body) {
  if (dailyBusy) return;
  dailyBusy = true;
  try {
    const r = await fetch(pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const d = await r.json();
    if (!d.error) dailyData = d;
  } catch (e) {}
  dailyBusy = false;
  renderDaily();
}

// 왜 이 카드가 이 슬롯에 있는지 한 줄로. 이게 없으면 그냥 랜덤과 구별이 안 된다.
function cardWhy(c) {
  if (c.slot === 'light' && c.paceMinutes != null) return t('whyPace', { m: c.paceMinutes });
  if (c.slot === 'comeback' && c.dormantDays != null) return t('whyDormant', { when: agoText(c.dormantDays) });
  if (c.playtimeMinutes) return t('whyPlaytime', { h: Math.max(1, Math.round(c.playtimeMinutes / 60)) });
  return '';
}

function drawCardHtml(c, i, picked) {
  const slotKey = 'slot' + c.slot.charAt(0).toUpperCase() + c.slot.slice(1);
  const g = { appid: c.appid, name: c.gameName, images: c.images };
  return `<article class="draw-card${picked ? ' is-picked' : ''}" style="--i:${i}" data-index="${i}">
    <span class="dc-art"><img src="${imgHeader(g)}" ${coverAttrs(g)}></span>
    <span class="dc-slot">${t(slotKey)}</span>
    <span class="dc-body">
      <span class="dc-tier">${tierBadge(c.tier)}<span class="dc-pct">${c.globalPercent}%</span></span>
      <span class="dc-ach" title="${esc(c.achName)}">${esc(c.achName)}</span>
      ${c.achDesc ? `<span class="dc-desc">${esc(c.achDesc)}</span>` : ''}
      <span class="dc-game">${esc(c.gameName)}</span>
      <span class="dc-why">${esc(cardWhy(c))}</span>
    </span>
    ${picked
      ? `<span class="dc-actions">
           <a class="dc-play" href="${steamRunUrl(c.appid)}">${t('dailyGo')}</a>
           <span class="dc-note">${t('dailyComeBack')}</span>
           <span class="dc-alt">
             <button class="dc-check" data-act="check">${t('checkNow')}</button>
             <a class="dc-store" href="https://store.steampowered.com/app/${c.appid}" target="_blank" rel="noopener">${t('dailyStore')}</a>
           </span>
         </span>`
      : `<button class="dc-pick" data-pick="${i}">${t('pickThis')}</button>`}
  </article>`;
}

function renderDaily() {
  const box = $('dailyContent');
  if (!box) return;
  if (!dailyData) { box.innerHTML = skelDeck(); loadDaily(); return; }
  if (dailyData.needsSync) {
    // 이미 동기화가 돌고 있는데 "지금 가져오기" 버튼을 내밀면 안 된다 —
    // 눌러도 아무 일이 없어 고장처럼 보인다. 도는 중이면 진행 상황을 보여준다.
    box.innerHTML = (syncing || syncIsStale()) ? syncingPanel() : emptyState(t('needSyncTitle'), t('needSyncDesc'),
      `<button class="es-btn" data-act="sync">${t('needSyncBtn')}</button>`);
    return;
  }

  const { cards = [], picked, justCompleted, rerollAvailable, stats = {}, recent = [] } = dailyData;

  // 판정 연출 — 이번 호출에서 확정된 성공만. 한 번 보여주고 소비한다.
  const doneHtml = justCompleted
    ? `<section class="done-banner">
        <span class="db-mark">🏆</span>
        <span class="db-body">
          <span class="db-title">${t('doneTitle')}</span>
          <span class="db-ach">${esc(justCompleted.achName)}
            <span class="db-pct">${justCompleted.globalPercent}%</span></span>
          <span class="db-sub">${esc(justCompleted.gameName)} · ${t('doneSub')}</span>
        </span>
      </section>`
    : '';

  if (!cards.length) {
    box.innerHTML = doneHtml + emptyState(t('dailyEmptyTitle'), t('dailyEmpty'));
    return;
  }

  const isPicked = picked != null;
  const shown = isPicked ? [cards[picked.index]] : cards;

  const syncedAt = state.me && state.me.updatedAt ? fmtDate(state.me.updatedAt) : null;
  const meta = [t('statsDone', { n: stats.done || 0 })];
  if (isPicked && syncedAt) meta.push(t('lastChecked', { date: syncedAt }));

  const deck = `<div class="draw-deck${isPicked ? ' single' : ''}">
    ${shown.map((c, i) => drawCardHtml(c, isPicked ? picked.index : i, isPicked)).join('')}
  </div>`;

  // 설명 → 행동 → 상태 순으로 하단에 모은다. 재뽑기는 하루 1회.
  const action = rerollAvailable
    ? `<button class="daily-reroll" data-act="${isPicked ? 'giveup' : 'reroll'}">${isPicked ? t('giveUpBtn') : t('rerollBtn')}</button>`
    : `<span class="daily-note">${t('rerollUsed')}<a class="daily-alt" href="#resume">${t('rerollUsedAlt')}</a></span>`;
  const foot = `<div class="daily-foot">
    <p class="daily-lead">${isPicked ? t('dailyPickedLead') : t('dailyLead')}</p>
    ${action}
    <div class="daily-meta">${meta.join(' · ')}</div>
  </div>`;

  const recentHtml = recent.length
    ? `<section class="coll-block"><h3 class="cb-title">${t('recentDone')}</h3>
        <div class="hscroll">${recent.map((h) => trophyCard({
          appid: h.appid, gameName: h.gameName, images: h.images, name: h.achName,
          globalPercent: h.globalPercent, tier: h.tier,
        })).join('')}</div></section>`
    : '';

  box.innerHTML = doneHtml + deck + foot + recentHtml;
}

$('dailyContent').addEventListener('click', (e) => {
  const pickBtn = e.target.closest('[data-pick]');
  if (pickBtn) return dailyAction('/api/draw/pick', { index: Number(pickBtn.dataset.pick) });
  const act = e.target.closest('[data-act]');
  if (!act) return;
  // 판정은 동기화가 한다. 유저가 직접 확인할 수 있는 길을 열어둔다 —
  // 깼는데 화면이 그대로면 기다리는 것 말곤 할 게 없었다.
  if (act.dataset.act === 'check' || act.dataset.act === 'sync') {
    act.disabled = true;
    act.textContent = t('checking');
    return startSync(false);
  }
  dailyAction('/api/draw/' + act.dataset.act);
});

// ── 수집함 ────────────────────────────────────────────────────────
// 희귀도는 "받을 보상"이 아니라 "해낸 것"의 등급으로 쓴다. 남은 도전과제의 76%가
// 20% 미만이라 보상 등급으로 쓰면 전부 "희귀"가 되어 의미가 없다.
// 반대로 이미 딴 것 중 5% 미만은 1.4%뿐 — 여기서만 등급이 실제로 희소하다.
let collectionData = null, collectionLoading = false;

async function loadCollection() {
  if (collectionLoading) return;
  collectionLoading = true;
  try { collectionData = await fetch('/api/collection').then((r) => r.json()); }
  catch (e) { collectionData = null; }
  collectionLoading = false;
  if (state.view === 'ach') renderAch();
}

// 2.1% 보다 "1000명 중 21명"이 훨씬 와닿는다.
const perThousand = (pct) => Math.max(1, Math.round(pct * 10));

// 등급은 색만으로 구분하면 안 들어온다. 항상 글자 배지를 같이 단다.
// 기준은 서버(src/collection.js)와 같아야 한다 — 같은 희귀도를 두 이름으로 부르면 혼란만 생긴다.
const collTierOf = (p) => (p < 5 ? 'legendary' : p < 20 ? 'rare' : p < 50 ? 'normal' : 'common');
const TIER_ICON = { legendary: '🏆', rare: '💎', normal: '🔹', common: '·' };
function tierBadge(tier) {
  const key = 'tier' + tier.charAt(0).toUpperCase() + tier.slice(1);
  return `<span class="tier-badge t-${tier}">${TIER_ICON[tier]} ${t(key)}</span>`;
}

// 텍스트만 있으면 "뭘 보라는 건데?"가 된다. 트로피에도 게임 아트를 붙인다.
function trophyCard(a) {
  return `<a class="trophy-card t-${a.tier}" href="#games/${a.appid}" title="${esc(a.name)} — ${esc(a.gameName)}">
    <span class="tc-head">${tierBadge(a.tier)}<span class="tc-pct">${a.globalPercent}%</span></span>
    <span class="tc-name" title="${esc(a.name)}">${esc(a.name)}</span>
    <span class="tc-game" title="${esc(a.gameName)}">${esc(a.gameName)}</span>
  </a>`;
}

// 게임별 카드 — 내 수집이 어디에 몰려 있는지 한눈에
function gameCollectionCard(g) {
  const pills = [];
  if (g.counts.legendary) pills.push(`<span class="cnt-pill t-legendary">${TIER_ICON.legendary} ${t('tierLegendary')} ${g.counts.legendary}</span>`);
  if (g.counts.rare) pills.push(`<span class="cnt-pill t-rare">${TIER_ICON.rare} ${t('tierRare')} ${g.counts.rare}</span>`);
  if (!pills.length) pills.push(`<span class="cnt-pill t-common">${t('tierTotal')} ${g.counts.total}</span>`);
  return `<a class="gcol-card" href="#games/${g.appid}" title="${esc(g.name)}">
    <span class="gc-art"><img src="${imgHeader(g)}" ${coverAttrs(g)}></span>
    <span class="gc-body">
      <span class="gc-name" title="${esc(g.name)}">${esc(g.name)}</span>
      <span class="gc-pills">${pills.join('')}</span>
      <span class="gc-prog">${t('achCount', { u: g.unlocked, t: g.total })} · ${g.completionPct}%</span>
    </span>
  </a>`;
}

// '모은 것' 탭 — 달성한 것 = 수집. 도전과제 뷰 안으로 들어왔다.
// 게임 한 장 = 그 게임의 트로피 묶음. 아트는 여기서 딱 한 번 쓰인다.
function gameTrophyCard(g, mode) {
  const list = mode === 'targets' ? g.nextUp : g.top;
  if (!list || !list.length) return '';
  const shown = list.slice(0, 3);
  const restCount = (mode === 'targets' ? g.remaining : g.counts.total) - shown.length;
  const pills = [];
  if (mode === 'targets') {
    pills.push(`<span class="cnt-pill t-common">${t('remainingCount', { n: g.remaining })}</span>`);
  } else {
    if (g.counts.legendary) pills.push(`<span class="cnt-pill t-legendary">${TIER_ICON.legendary} ${g.counts.legendary}</span>`);
    if (g.counts.rare) pills.push(`<span class="cnt-pill t-rare">${TIER_ICON.rare} ${g.counts.rare}</span>`);
    if (!pills.length) pills.push(`<span class="cnt-pill t-common">${g.counts.total}</span>`);
  }
  const rows = shown.map((a) => `<a class="gt-row t-${a.tier}" href="#games/${g.appid}" title="${esc(a.name)}${a.description ? ' — ' + esc(a.description) : ''}">
      <span class="gt-pct">${a.globalPercent}%</span>
      <span class="gt-name">${esc(a.name)}</span>
    </a>`).join('');
  return `<article class="gt-card">
    <a class="gt-head" href="#games/${g.appid}" title="${esc(g.name)}">
      <img class="gt-art" src="${imgHeader(g)}" ${coverAttrs(g)}>
      <span class="gt-shade"></span>
      <span class="gt-title">${esc(g.name)}</span>
    </a>
    <div class="gt-meta">${pills.join('')}<span class="gt-prog">${t('achCount', { u: g.unlocked, t: g.total })} · ${g.completionPct}%</span></div>
    <div class="gt-rows">${rows}</div>
    ${restCount > 0 ? `<a class="gt-more" href="#games/${g.appid}">${t('moreCount', { n: restCount })}</a>` : ''}
  </article>`;
}

function renderCollected(box) {
  if (!collectionData) { box.innerHTML = skelGrid(6, 'gt-grid'); loadCollection(); return; }

  const { counts, crown, games, harvest } = collectionData;
  // crown(최고 기록 하나를 크게)은 뺐다 — 게임 하나가 화면 위를 다 먹어서
  // "내 수집을 보자"는 목적에 오히려 방해가 됐다. 게임별 트로피만 남긴다.
  if (!crown) {
    box.innerHTML = emptyState(t('collectionEmptyTitle'), t('collectionEmpty'),
      `<a class="es-btn" href="#daily">${t('goDaily')}</a>`);
    return;
  }

  // 등급 인덱스 — 색만으로는 안 들어온다. 기준을 글자로 못박는다.
  // 누르면 그 등급을 가진 게임만 남는다(필터). 숫자를 보고 "그럼 어느 게임?"이
  // 바로 이어지는데, 예전엔 그게 막다른 길이었다.
  const sel = state.collTier || 'all';
  const tiles = [
    { key: 'legendary', n: counts.legendary },
    { key: 'rare', n: counts.rare },
  ].map((x) => `<button class="tier-tile t-${x.key}${sel === x.key ? ' on' : ''}" data-tier="${x.key}" aria-pressed="${sel === x.key}">
      <span class="tt-head">${TIER_ICON[x.key]} ${t('tier' + x.key.charAt(0).toUpperCase() + x.key.slice(1))}</span>
      <span class="tt-n">${x.n}</span>
      <span class="tt-desc">${t(x.key === 'legendary' ? 'tierLegendaryDesc' : 'tierRareDesc')}</span>
    </button>`).join('');
  const tilesHtml = `<div class="tier-row">${tiles}
    <button class="tier-tile t-total${sel === 'all' ? ' on' : ''}" data-tier="all" aria-pressed="${sel === 'all'}">
      <span class="tt-head">${t('tierTotal')}</span>
      <span class="tt-n">${counts.total}</span><span class="tt-desc">${t('tierAllDesc')}</span></button>
  </div>`;



  const withTrophies = (games || [])
    .filter((g) => g.top && g.top.length)
    .filter((g) => sel === 'all' || (g.counts && g.counts[sel] > 0));
  const gamesHtml = `<section class="coll-block">
    <h3 class="group-title">${t('gamesTrophies')}<span class="gt-count">${t('collectionCount', { n: withTrophies.length })}</span>
      ${sel !== 'all' ? `<button class="tier-clear" data-tier="all">${t('tierClear')}</button>` : ''}</h3>
    ${withTrophies.length
      ? `<div class="gt-grid">${withTrophies.map((g) => gameTrophyCard(g, 'collected')).join('')}</div>`
      : `<div class="empty">${t('tierNoGames')}</div>`}
  </section>`;

  const harvestHtml = `<section class="coll-block">
    <h3 class="group-title">${t('harvestTitle', { d: harvest.days })}
      <span class="gt-count">${harvest.count ? t('collectionCount', { n: harvest.count }) : ''}</span></h3>
    ${harvest.count
      ? `<div class="trophy-grid">${harvest.items.map(trophyCard).join('')}</div>`
      : `<div class="empty">${t('harvestNone')}</div>`}
  </section>`;

  box.innerHTML = tilesHtml + gamesHtml + harvestHtml;
}

// '노릴 것' 탭 — 미달성 = 사냥감. '모은 것'과 정확히 반대 축이다.
function renderTargets(box) {
  if (!collectionData) { box.innerHTML = skelGrid(6, 'gt-grid'); loadCollection(); return; }
  const { counts, nextTargets, almostDone, games } = collectionData;

  // 1) 가까운 후보 — 남은 전설 중 가장 손에 닿는 것들
  const nextHtml = nextTargets.length
    ? `<section class="coll-block">
        <h3 class="group-title">${t('nextTargetTitle')}</h3>
        <p class="cb-lead">${t('nextTargetLead')}</p>
        <div class="target-list">${nextTargets.map((x) => {
          const g = { appid: x.appid, name: x.gameName, images: x.images };
          return `<div class="target">
            <img class="tg-art" src="${imgHeader(g)}" ${coverAttrs(g)}>
            <span class="tg-pct t-legendary">${x.globalPercent}%</span>
            <span class="tg-body">
              <span class="tg-name" title="${esc(x.name)}">${esc(x.name)}</span>
              <span class="tg-game">${esc(x.gameName)} · ${t('nextTargetPlayed', { h: Math.round(x.playtimeMinutes / 60) })}</span>
            </span>
            <a class="tg-go" href="${steamRunUrl(x.appid)}">▶ ${t('challenge')}</a>
          </div>`;
        }).join('')}</div>
      </section>`
    : '';

  // 2) 거의 다 깬 게임 — 완주가 눈앞이면 동기가 가장 세다
  const almost = (almostDone || []).filter((g) => g.nextUp && g.nextUp.length);
  const almostHtml = almost.length
    ? `<section class="coll-block">
        <h3 class="group-title">${t('almostTitle')}</h3>
        <p class="cb-lead">${t('almostLead')}</p>
        <div class="almost-list">${almost.map((g) => `
          <a class="almost-row" href="#games/${g.appid}" title="${esc(g.name)}">
            <img class="am-art" src="${imgHeader(g)}" ${coverAttrs(g)}>
            <span class="am-body">
              <span class="am-top"><span class="am-name">${esc(g.name)}</span>
                <span class="am-pct">${g.completionPct}%</span></span>
              <span class="am-bar"><i style="width:${g.completionPct}%"></i></span>
              <span class="am-sub">${t('achCount', { u: g.unlocked, t: g.total })} · ${t('remainingCount', { n: g.remaining })}</span>
            </span>
          </a>`).join('')}</div>
      </section>`
    : '';

  // 3) 게임별 남은 트로피 — 라이브러리 전체를 훑을 수 있게
  const withLeft = (games || []).filter((g) => g.nextUp && g.nextUp.length);
  const gamesHtml = `<section class="coll-block">
    <h3 class="group-title">${t('targetsByGame')}<span class="gt-count">${t('collectionCount', { n: withLeft.length })}</span></h3>
    ${withLeft.length
      ? `<div class="gt-grid">${withLeft.map((g) => gameTrophyCard(g, 'targets')).join('')}</div>`
      : `<div class="empty">${t('emptyGroup')}</div>`}
  </section>`;

  box.innerHTML = nextHtml + almostHtml + gamesHtml;
}


// ── 게임 상세 ─────────────────────────────────────────────────────
const detailCache = {};
function closeDetail() {
  state.detailAppid = null;
  $('gameDetail').classList.add('hidden');
  $('gamesBrowse').classList.remove('hidden');
}
async function openDetail(appid) {
  appid = Number(appid);
  state.detailAppid = appid;
  $('gamesBrowse').classList.add('hidden');
  const box = $('gameDetail');
  box.classList.remove('hidden');
  box.innerHTML = `<button class="detail-back" id="detailBack">${t('back')}</button>` +
    `<div class="skel skel-art" style="aspect-ratio:1000/300;border-radius:var(--r-lg)"></div>` +
    `<div style="margin-top:18px">${skelLines(['w45','w90','w70'])}</div>` + loadNote();
  $('detailBack').onclick = () => navigate('games');
  const key = appid + '_' + LANG;
  let data = detailCache[key];
  if (!data) {
    try { data = await fetch('/api/game/' + appid + '?lang=' + LANG).then((r) => r.json()); detailCache[key] = data; }
    catch (e) { box.innerHTML = `<button class="detail-back" id="detailBack">${t('back')}</button><div class="empty">${t('friendFail')}</div>`; $('detailBack').onclick = () => navigate('games'); return; }
  }
  if (state.detailAppid !== appid) return; // 그 사이 뒤로 감
  renderDetail(appid, data);
}
function achListHtml(arr) {
  return `<div class="d-ach-list">` + arr.map((a) =>
    `<div class="ach-row ${a.achieved ? '' : 'locked'}"><div><div class="a-name">${a.achieved ? '🏅 ' : '🔒 '}${esc(a.name)}</div><div class="a-desc">${esc(a.description)}</div></div><div class="a-pct">${a.globalPercent != null ? a.globalPercent.toFixed(1) + '%' : ''}</div></div>`
  ).join('') + `</div>`;
}
function renderDetail(appid, d) {
  const info = d.info || {};
  const pr = d.progress || {};
  const name = info.name || pr.name || appid;
  const hero = info.headerImage || (pr.images && pr.images.header) || imgHeader({ appid });
  const meta = [];
  if (info.developers && info.developers.length) meta.push(`${t('dDev')}: ${esc(info.developers.join(', '))}`);
  if (info.genres && info.genres.length) meta.push(esc(info.genres.join(', ')));
  if (info.releaseDate) meta.push(`${t('dRelease')} ${esc(info.releaseDate)}`);
  // Metacritic·가격은 아래 지표 스트립으로 옮겼다 — 같은 숫자를 두 번 쓰지 않는다

  // 핵심 지표 — 흩어져 있던 숫자를 한 줄로 모은다.
  // 상세 페이지에서 제일 먼저 보고 싶은 건 "이 게임 괜찮나 / 내가 얼마나 했나 / 얼마인가" 다.
  function statTile(value, label, sub, tone) {
    return `<div class="d-stat${tone ? ' t-' + tone : ''}">
      <span class="ds-value">${value}</span>
      <span class="ds-label">${label}</span>
      <span class="ds-sub">${sub || '&nbsp;'}</span>
    </div>`;
  }
  // 큰 숫자는 만 단위로. "1,148,151개" 보다 "114.8만개" 가 한눈에 읽힌다
  const compactCount = (n) => (n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '만' : n.toLocaleString());
  const rvAll = d.reviews;
  const posPctAll = rvAll && rvAll.total_reviews ? Math.round((rvAll.total_positive / rvAll.total_reviews) * 100) : null;
  const achAll = pr.ach && pr.ach.hasAchievements ? pr.ach : null;
  const tiles = [];
  if (posPctAll != null) {
    tiles.push(statTile(posPctAll + '%', t('dsReviews'),
      t('dsReviewCount', { n: compactCount(rvAll.total_reviews) }),
      posPctAll >= 70 ? 'good' : posPctAll >= 40 ? 'mid' : 'bad'));
  }
  if (info.metacritic) tiles.push(statTile(info.metacritic, 'Metacritic', t('dsOutOf100'), info.metacritic >= 75 ? 'good' : 'mid'));
  // 기록을 못 읽었을 때 '한 번도 안 함'으로 적으면 거짓말이 된다 — '동기화 전'으로 구분한다
  const noRec = !d.progress || !d.progress.name;
  tiles.push(statTile(
    noRec ? t('dsNoSync') : (pr.playtimeMinutes ? t('dPlaytime', { h: Math.round(pr.playtimeMinutes / 60) }) : t('dsNeverShort')),
    t('dsMyRecord'),
    noRec ? '&nbsp;'
      : achAll ? t('achCount', { u: achAll.unlocked, t: achAll.total })
      : (pr.playtimeMinutes ? t('dLastPlayed') + ' ' + (pr.lastPlayed ? fmtDate(pr.lastPlayed) : '-') : t('dNever'))));
  if (info.price) tiles.push(statTile(esc(info.price), t('dsPrice'), d.dlcTotal ? t('dsDlcCount', { n: d.dlcTotal }) : ''));
  const statStrip = tiles.length
    ? `<section class="d-stats"><h3 class="ds-title">${t('dsTitle')}</h3><div class="d-stat-row">${tiles.join('')}</div></section>`
    : '';

  // 내 기록 — 예전엔 '진척도'와 '도전과제'가 따로였는데, 진척도의 숫자는 위 지표
  // 스트립으로 올라갔다. 남은 건 "내가 이 게임에서 뭘 했나" 하나라 카드도 하나로 합친다.
  const ach = pr.ach && pr.ach.hasAchievements ? pr.ach : null;
  let recInner = '';
  // progress 가 통째로 비었다 = 이 게임을 못 찾은 것이지 "안 한" 게 아니다.
  // 동기화 전이거나 라이브러리에 없는 게임인데 "한 번도 안 켰다"고 단정하면 거짓말이다.
  const noRecord = !d.progress || !d.progress.name;
  if (noRecord) {
    // 보유하지 않은 게임에 "동기화하세요"라고 하면 유저는 고칠 수 없는 걸 고치려 든다.
    recInner += d.progressReason === 'not-owned'
      ? `<div class="empty">${t('dNotOwned')}</div>`
      : `<div class="empty">${t('dNoSync')}</div>
         <div style="margin-top:10px"><button class="es-btn" data-act="sync">${t('dSyncNow')}</button></div>`;
  } else if (pr.playtimeMinutes) {
    const bits = [`<b>${t('dPlaytime', { h: Math.round(pr.playtimeMinutes / 60) })}</b>`];
    // 날짜만으론 "언제 했더라"가 안 풀린다 — 시각까지.
    if (pr.lastPlayed) bits.push(`${t('dLastPlayed')} ${fmtDateTime(pr.lastPlayed)}`);
    if (pr.playtime2weeks) bits.push(t('dRecent2w', { h: Math.max(1, Math.round(pr.playtime2weeks / 60)) }));
    recInner += `<div class="d-kv">${bits.join(' · ')}</div>`;
  } else {
    recInner += `<div class="empty">${t('dNever')}</div>`;
  }
  if (noRecord) {
    // 기록을 못 읽은 상태에서 "도전과제 없음"이라고 하면 그것도 거짓말이다
  } else if (ach) {
    const unlocked = ach.achievements.filter((a) => a.achieved).sort((a, b) => (b.unlockTime || 0) - (a.unlockTime || 0));
    const locked = ach.achievements.filter((a) => !a.achieved).sort((a, b) => (b.globalPercent || 0) - (a.globalPercent || 0));
    recInner += `<div class="d-prog-bar"><i style="width:${ach.completionPct}%"></i></div>
      <div class="d-kv">${t('achCount', { u: ach.unlocked, t: ach.total })} · ${ach.completionPct}%</div>`;
    if (pr.lastAchievement) recInner += `<div class="d-kv">${t('dLastAch')}: <b>🏅 ${esc(pr.lastAchievement.name)}</b> <span style="color:var(--muted)">(${fmtDate(pr.lastAchievement.unlockTime)})</span></div>`;
    // 데스크톱은 좌우 두 컬럼, 모바일은 탭 하나씩. 330px 을 반으로 쪼개면 둘 다 못 읽는다.
    // 두 리스트를 항상 그려두고 보이는 것만 바꾼다 — 탭을 눌러도 재조회가 없다.
    // .dac-tabs 는 데스크톱에서 display:none 이라 그리드에 자리를 차지하지 않는다.
    recInner += `<div class="d-ach-cols" style="margin-top:12px">
      <div class="dac-tabs">
        <button class="dac-tab active" aria-pressed="true" data-col="unlocked">${t('dAchUnlocked')} (${unlocked.length})</button>
        <button class="dac-tab" aria-pressed="false" data-col="locked">${t('dAchLocked')} (${locked.length})</button>
      </div>
      <div class="dac-col on" data-col="unlocked"><div class="gh-sub">${t('dAchUnlocked')} (${unlocked.length})</div>${achListHtml(unlocked)}</div>
      <div class="dac-col" data-col="locked"><div class="gh-sub">${t('dAchLocked')} (${locked.length})</div>${achListHtml(locked)}</div>
    </div>`;
  } else {
    recInner += `<div class="gh-sub" style="margin-top:6px">${t('dNoAchShort')}</div>`;
  }
  const achCard = `<div class="d-card" style="grid-column:1/-1"><h3>${t('dMyRecord')}${ach ? ` <span class="muted">${ach.unlocked}/${ach.total}</span>` : ''}</h3>${recInner}</div>`;

  // 뉴스 카드
  const news = d.news || [];
  const newsInner = news.length ? news.map((n) =>
    `<div class="news-item"><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="n-date">${fmtDate(n.date)}${n.feedlabel ? ' · ' + esc(n.feedlabel) : ''}</div></div>`
  ).join('') : `<div class="empty">${t('dNoNews')}</div>`;
  const newsCard = `<div class="d-card"><h3>📰 ${t('dNews')}</h3>${newsInner}</div>`;

  // DLC 카드
  const dlc = d.dlc || [];
  const dlcInner = dlc.length ? `<div class="dlc-grid">` + dlc.map((x) =>
    `<a class="dlc-item" href="https://store.steampowered.com/app/${x.appid}" target="_blank" rel="noopener"><img src="${esc(x.header)}" data-fallback="${esc(x.name)}"><span class="dlc-name">${esc(x.name)}</span>${x.price ? `<span class="dlc-price">${esc(x.price)}</span>` : ''}</a>`
  ).join('') + `</div>` + (d.dlcTotal > dlc.length ? `<div class="gh-sub" style="margin-top:8px">${t('dDlcMore', { n: d.dlcTotal - dlc.length })}</div>` : '') : `<div class="empty">${t('dNoDlc')}</div>`;
  const dlcCard = `<div class="d-card"><h3>🧩 ${t('dDlc')}</h3>${dlcInner}</div>`;

  const cachedNote = d.cachedAt ? `<span class="muted" style="color:var(--muted);font-size:11px;margin-left:8px">· ${t('dCached')} ${fmtDate(Math.floor(d.cachedAt / 1000))}</span>` : '';

  $('gameDetail').innerHTML =
    `<button class="detail-back" id="detailBack">${t('back')}</button>` +
    `<div class="detail-hero"><img src="${esc(hero)}" data-fallback="${esc(name)}"><div class="dh-shade"></div><div class="dh-body"><h2>${esc(name)}${cachedNote}</h2><div class="detail-meta">${meta.map((m) => `<span>${m}</span>`).join('')}</div></div></div>` +
    `<div class="detail-actions"><a class="d-play" href="${steamRunUrl(appid)}">${t('dPlay')}</a><a class="d-steam" href="https://store.steampowered.com/app/${appid}" target="_blank" rel="noopener">${t('dSteam')}</a></div>` +
    statStrip +
    (info.shortDescription ? `<div class="detail-desc">${esc(info.shortDescription)}</div>` : '') +
    `<div class="detail-grid">${achCard}${newsCard}${dlcCard}</div>`;
  $('detailBack').onclick = () => navigate('games');
  const syncBtn = $('gameDetail').querySelector('[data-act="sync"]');
  if (syncBtn) syncBtn.onclick = () => startSync(false);
}

// ── 도전과제 ──────────────────────────────────────────────────────
document.querySelectorAll('.subtab').forEach((b) =>
  b.addEventListener('click', () => navigate('ach/' + b.dataset.group))
);

function withAchGames() {
  return state.games.filter((g) => g.ach && g.ach.hasAchievements && g.ach.total > 0);
}
function renderAch() {
  $('achWarn').classList.toggle('hidden', !state.achievementsBlocked);
  const box = $('achContent');
  // '없다'와 '아직 못 받았다'와 '못 읽는다'는 다른 상태다. 한 문장으로 뭉치면
  // 데이터가 오는 중인데도 "없어요"라고 단정하는 거짓말이 된다.
  // (renderGames·renderDaily 는 이미 이 규칙을 지키고 있었는데 여기만 빠져 있었다.
  //  Render 무료 플랜은 재배포하면 캐시가 날아가서 정확히 이 경로로 들어온다.)
  if (!gamesLoadedOnce) { box.innerHTML = skelGrid(6, 'gt-grid'); return; }
  if (!state.games.length) {
    box.innerHTML = (syncing || syncIsStale())
      ? syncingPanel()
      : emptyState(t('needSyncTitle'), t('needSyncDesc'),
          `<button class="es-btn" data-act="sync">${t('needSyncBtn')}</button>`);
    return;
  }
  if (!withAchGames().length) {
    // 비공개는 '없는' 게 아니라 '못 읽는' 것이다. 위 경고 배너가 방법을 알려주므로
    // 여기서는 그 배너를 가리키기만 한다 — 같은 화면에서 서로 다른 말을 하면 안 된다.
    box.innerHTML = `<div class="empty">${state.achievementsBlocked ? t('achBlockedEmpty') : t('noAchGames')}</div>`;
    return;
  }
  if (state.achGroup === 'collected') renderCollected(box);
  else if (state.achGroup === 'targets') renderTargets(box);
  else renderAchByGame(box);
}

// 등급 타일 = 필터. 같은 걸 다시 누르면 해제되어 전체로 돌아온다.
$('achContent').addEventListener('click', (e) => {
  // 동기화 전 빈 화면의 '지금 가져오기'. 버튼만 그려놓고 안 물리면 눌러도
  // 아무 일이 없어 고장으로 읽힌다.
  const sync = e.target.closest('[data-act="sync"]');
  if (sync) {
    sync.disabled = true;
    sync.textContent = t('checking');
    return startSync(false);
  }
  const btn = e.target.closest('[data-tier]');
  if (!btn) return;
  const next = btn.dataset.tier;
  state.collTier = next === state.collTier ? 'all' : next;
  renderCollected($('achContent'));
});

// '게임별' 탭 — 수집 현황(전설/희귀 개수)과 진행률을 한 카드에. 누르면 게임 상세로.
// 예전에는 아코디언으로 도전과제를 펼쳤지만, 상세 페이지가 그걸 더 잘 보여준다.
function renderAchByGame(box) {
  if (!collectionData) { box.innerHTML = skelGrid(6, 'gt-grid'); loadCollection(); return; }
  const games = collectionData.games || [];
  if (!games.length) { box.innerHTML = `<div class="empty">${t('gameShelfEmpty')}</div>`; return; }
  box.innerHTML = `<p class="cb-lead">${t('gameShelfLead')}</p>
    <div class="gcol-grid">${games.map(gameCollectionCard).join('')}</div>`;
}

// ── 친구 코옵 ─────────────────────────────────────────────────────
let friendLoading = false, friendData = null;

// 버튼을 없앴다. 동기화된 정보로 만들 수 있는 화면인데 한 번 더 누르게 할 이유가 없다.
// (서버가 60초 캐시를 물고 있어 탭을 오갈 때마다 새로 계산하지도 않는다)
// 친구 목록 조회 실패는 일시적인 경우가 많다 — 다시 시도 버튼을 준다.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act="retry-friends"]');
  if (!b) return;
  friendData = null;
  loadFriends();
});

function renderFriendsIfLoaded() {
  if (friendData) renderFriends(friendData);
  else loadFriends();
}
async function loadFriends() {
  if (friendLoading) return;
  friendLoading = true;
  $('friendProgress').classList.remove('hidden');
  $('friendProgress').textContent = t('friendChecking');
  // 친구 조회는 친구 수만큼 순차 호출이라 제일 오래 걸린다 — 빈 화면으로 두지 않는다
  $('friendList').innerHTML = skelGrid(4, 'friend-grid');
  try { friendData = await fetch('/api/friends').then((r) => r.json()); renderFriends(friendData); }
  catch (e) { $('friendProgress').textContent = t('friendFail'); }
  friendLoading = false;
}
function renderFriends(res) {
  const list = $('friendList');
  if (res.error) { $('friendProgress').textContent = '❌ ' + res.error; return; }
  // '못 읽음'과 '비공개'를 구분한다 — 전자는 다시 시도하면 되고, 후자는 설정을 바꿔야 한다.
  if (res.fetchError) {
    $('friendProgress').textContent = t('friendFetchFail');
    list.innerHTML = `<div class="empty">${t('friendFetchFailHint')}<br><button class="es-btn" style="margin-top:10px" data-act="retry-friends">${t('retry')}</button></div>`;
    return;
  }
  if (res.privateFriendList || res.friendCount === 0) { $('friendProgress').textContent = t('friendPrivate'); list.innerHTML = ''; return; }
  if (!res.games || !res.games.length) { $('friendProgress').textContent = t('friendNoCoop', { n: res.friendCount }); list.innerHTML = ''; return; }
  let summary = t('friendSummary', { n: res.friendCount, p: res.publicFriends, g: res.games.length });
  // 태그 수집은 회차를 나눠 채운다 — 아직 남았으면 알려준다
  if (res.tagsPending) summary += ' · ' + t('friendTagsPending', { n: res.tagsPending });
  $('friendProgress').textContent = summary;

  function friendGameHtml(g) {
    const tag = g.coop ? t('coop') : t('multi');
    const img = (g.images && g.images.header) || imgHeader(g);
    const owners = g.owners.map((o) => {
      const av = o.avatar ? `<img src="${o.avatar}">` : '';
      const playing = o.playingThis ? ` <span class="playing">${t('playingNow')}</span>` : o.inGameName ? ` <span class="playing">(${esc(o.inGameName)})</span>` : '';
      return `<span class="owner ${o.online ? 'on' : ''}"><span class="dot"></span>${av}${esc(o.name)}${playing}</span>`;
    }).join('');
    return `<div class="friend-game"><img class="fg-img" src="${img}" ${coverAttrs(g)}><div class="fg-body"><div class="fg-top"><span class="fg-name" title="${esc(g.name)}">${esc(g.name)}</span> <span class="fg-tag">${tag}</span><a class="fg-play" href="${steamRunUrl(g.appid)}">▶ ${t('play')}</a></div><div class="owners">${owners}</div></div></div>`;
  }

  // 성격별 그룹. 서버가 못 묶어줬으면(옛 응답) 통짜 목록으로 떨어진다.
  const groups = res.groups && res.groups.length ? res.groups : [{ key: null, games: res.games }];
  list.innerHTML = groups.map((grp) => {
    const title = grp.key
      ? `<h3 class="fg-group-title">${t('bucket_' + grp.key)}<span class="fg-count">${t('collectionCount', { n: grp.games.length })}</span></h3>`
      : '';
    return `<section class="friend-group">${title}
      <div class="friend-grid">${grp.games.map(friendGameHtml).join('')}</div></section>`;
  }).join('');
}

// ── 모바일 셸 ─────────────────────────────────────────────────────
// 상단 한 줄 + 하단 탭바 4개 + 더보기 시트.
// 탭바는 .nav-item 클래스를 그대로 쓴다 — 활성 표시(applyRoute)와 클릭 처리가
// 이미 클래스 단위로 걸려 있어 라우팅 코드를 건드릴 필요가 없다.
// 여기서 더하는 것은 네 가지뿐:
//   (1) 상단바 제목·아바타·알림점 동기화  (2) 시트 열닫기
//   (3) 가로 스크롤 끝 페이드            (4) 상세 달성/미달성 탭

// 상단바 제목은 LNB 의 긴 이름을 쓴다. 탭 라벨은 짧은 별도 키(tab*)라서
// 여기서 전체 이름을 보여주면 둘이 서로를 보완한다.
const MOBILE_TITLE = {
  daily: 'navDaily', spin: 'navSpin', resume: 'navResume',
  games: 'navGames', ach: 'navAch', friends: 'navFriends',
};

function syncTopbar() {
  const title = $('mTitle');
  if (title) title.textContent = t(MOBILE_TITLE[state.view] || 'appTitle');
  const av = $('mAvatar');
  const src = $('avatar') ? $('avatar').getAttribute('src') : null;
  // src 가 빈 문자열이면 브라우저가 '깨진 이미지' 아이콘을 그린다 — 아예 비운다
  if (av) { if (src) av.src = src; else av.removeAttribute('src'); }
  const needs = syncNeedsAttention();
  const dot = $('mMoreDot');
  if (dot) dot.classList.toggle('hidden', !needs);
  // 점은 9px 금색 동그라미 하나다 — 모양과 색만으로는 안 보이는 사람에게
  // 아무 말도 하지 않는다. 버튼 이름에 상태를 실어준다.
  const btn = $('mMore');
  if (btn) btn.setAttribute('aria-label', needs ? t('openMenuSyncNeeded') : t('openMenu'));
}

// ── 더보기 시트 ──
function sheetOpen() { const a = $('app'); return !!a && a.classList.contains('sheet-open'); }
// 시트 밖에서 초점이 돌아다니면 안 되는 것들. 탭바가 DOM 상 main 뒤에 있어서
// 로그아웃 다음으로 Tab 하면 안 보이는 스크림 뒤의 탭으로 들어가, 누르면
// 시트가 열린 채 화면이 바뀌었다. inert 는 초점과 접근성 트리를 한 번에 막는다.
const SHEET_BACKDROP = ['.mtopbar', '.main', '.tabbar'];
let sheetReturnFocus = null;

function setSheet(open) {
  const app = $('app');
  if (!app) return;
  const sheet = $('lnbSheet');
  const isMobile = document.documentElement.classList.contains('mobile');
  app.classList.toggle('sheet-open', open);
  // 뒤 페이지가 같이 스크롤되면 시트가 딸려 올라간 것처럼 보인다.
  // 단 캡처 모드는 프레임 전체가 길어져야 하므로 잠그지 않는다.
  document.documentElement.classList.toggle('sheet-lock', open && !app.classList.contains('capture'));
  const btn = $('mMore');
  if (btn) btn.setAttribute('aria-expanded', String(open));

  // 모달 역할은 '모바일에서 열려 있을 때'만 사실이다. 데스크톱 LNB 는 상시
  // 노출이라 aria-modal 을 달면 바깥을 못 읽는 것처럼 알려 오히려 해롭다.
  const modal = open && isMobile;
  if (sheet) {
    if (modal) {
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-modal', 'true');
      sheet.setAttribute('aria-label', t('menuMore'));
    } else {
      sheet.removeAttribute('role');
      sheet.removeAttribute('aria-modal');
      sheet.removeAttribute('aria-label');
    }
  }
  for (const sel of SHEET_BACKDROP) {
    const el = document.querySelector(sel);
    if (el) el.inert = modal;
  }

  if (modal) {
    sheetReturnFocus = document.activeElement;
    const first = $('sheetClose');
    if (first) first.focus();
  } else if (sheetReturnFocus) {
    // visibility:hidden 이 걸리면 시트 안에 있던 초점이 body 로 떨어져,
    // 키보드 사용자는 문서 맨 위부터 Tab 을 다시 해야 했다.
    const back = sheetReturnFocus;
    sheetReturnFocus = null;
    if (back.isConnected && !back.inert) back.focus();
  }
}
if ($('mMore')) $('mMore').addEventListener('click', () => setSheet(!sheetOpen()));
if ($('sheetClose')) $('sheetClose').addEventListener('click', () => setSheet(false));
if ($('sheetScrim')) $('sheetScrim').addEventListener('click', () => setSheet(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetOpen()) setSheet(false); });
// 시트에서 화면을 옮겼으면 시트는 닫힌다 — 안 닫으면 이동한 결과를 못 본다.
// 언어 전환은 예외다(바뀐 걸 그 자리에서 확인해야 한다).
if ($('lnbSheet')) $('lnbSheet').addEventListener('click', (e) => {
  if (e.target.closest('.nav-item, .logout')) setSheet(false);
});
window.addEventListener('hashchange', () => setSheet(false));

// ── 가로 스크롤 끝 페이드 ──
// 스크롤바는 감추고 '더 있다'는 사실만 남긴다. 양끝 상태를 실제 scrollLeft 로
// 판정한다 — 항상 깔아두면 끝까지 스크롤한 뒤에도 더 있다고 거짓말을 한다.
const FADE_SEL = '.hscroll, .sort-bar, .subtabs, .tier-row';
function updateFade(el) {
  const max = el.scrollWidth - el.clientWidth;
  const over = max > 2; // 반올림 오차만큼은 넘침으로 보지 않는다
  el.classList.toggle('can-left', over && el.scrollLeft > 2);
  el.classList.toggle('can-right', over && el.scrollLeft < max - 2);
}
function wireFades() {
  const on = document.documentElement.classList.contains('mobile');
  document.querySelectorAll(FADE_SEL).forEach((el) => {
    el.classList.toggle('fade-x', on);
    // 데스크톱으로 넓히면 흔적을 지운다 — 안 지우면 마스크 클래스가 남는다
    if (!on) { el.classList.remove('can-left', 'can-right'); return; }
    if (!el.dataset.fadeWired) {
      el.dataset.fadeWired = '1';
      el.addEventListener('scroll', () => updateFade(el), { passive: true });
    }
    updateFade(el);
  });
}
// 가로 스크롤 줄은 여러 경로에서 새로 만들어진다 — renderView 뿐 아니라
// loadDaily·dailyAction·loadCollection·등급 필터 클릭도 각자 렌더한다.
// 호출을 일일이 심으면 한 곳을 빼먹는 순간 페이드가 조용히 사라진다
// (실제로 loadDaily·loadCollection 경로가 그렇게 빠져 있었다: .hscroll 에 fade-x 미적용).
// 그래서 '누가 렌더했는지' 대신 'DOM 이 바뀌었는지'를 본다.
// 디바운스는 rAF 가 아니라 타이머로 한다. rAF 는 탭이 백그라운드거나 프레임이
// 눌리면 안 불릴 수 있는데, '이미 예약됨' 플래그로 잠그면 그 한 번을 놓친 뒤
// 영구히 멈춘다. clearTimeout+재예약은 놓쳐도 다음 변경에서 스스로 복구된다.
let fadeTimer = 0;
function queueFades() {
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(wireFades, 0);
}
// childList 만 관찰한다 — wireFades 는 클래스/데이터 속성만 건드리므로 자기 자신을 다시 부르지 않는다
new MutationObserver(queueFades).observe(document.documentElement, { childList: true, subtree: true });
// 폭이 바뀌면 넘침 여부가 바뀐다 (DOM 은 그대로라 관찰자가 못 잡는다)
window.addEventListener('resize', wireFades);
// html.mobile 이 토글된 직후에도 다시 물린다. resize 는 미디어쿼리 평가보다
// 먼저 돌기 때문에 위 리스너만으로는 경계를 넘는 그 한 번을 놓친다
// (index.html 의 게이트가 이 훅을 부른다).
window.onBreakpointChange = () => {
  wireFades();
  // 데스크톱으로 넘어가면 '시트'라는 개념이 없어진다 —
  // inert·스크롤락·모달 속성을 걷지 않으면 화면이 잠긴 채로 남는다.
  if (sheetOpen()) setSheet(false);
};

// 상세의 달성/미달성 탭 (모바일에서만 보인다)
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.dac-tab');
  if (!tab) return;
  const box = tab.closest('.d-ach-cols');
  if (!box) return;
  // role="tab" 은 쓰지 않는다. 그 역할은 화살표키 이동과 연결된 tabpanel 을
  // 약속하는데 둘 다 없어서, 역할만 달면 일반 버튼보다 오히려 오해를 준다.
  // 누름 상태를 가진 토글 버튼이 지금 동작과 정확히 일치한다.
  box.querySelectorAll('.dac-tab').forEach((x) => {
    const on = x === tab;
    x.classList.toggle('active', on);
    x.setAttribute('aria-pressed', String(on));
  });
  box.querySelectorAll('.dac-col').forEach((c) => c.classList.toggle('on', c.dataset.col === tab.dataset.col));
});

// ── 시작 ──────────────────────────────────────────────────────────
// 디자인 캔버스 임포트용 뷰포트 고정.
// Pen 내장 브라우저는 폭이 매번 달라(688~2400px) 같은 화면이 다른 breakpoint 로
// 캡처된다. ?w=1920&h=1080 을 붙이면 표준 PC 크기로 고정된다.
// 높이는 '최소'라서 내용이 길면 프레임이 늘어난다 — 잘리지 않게 하려는 것.
(function captureViewport() {
  const q = new URLSearchParams(location.search);
  const w = parseInt(q.get('w'), 10);
  const h = parseInt(q.get('h'), 10);
  const okW = w >= 320 && w <= 3840;
  const okH = h >= 400 && h <= 4320;
  if (!okW && !okH) return;
  if (okH) document.documentElement.style.setProperty('--vh', h + 'px');

  for (const id of ['app', 'loginScreen']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.add('capture'); // LNB 를 sticky 대신 전체 높이로 (스냅샷용)
    if (okW) { el.style.width = w + 'px'; el.style.margin = '0 auto'; }
  }
  // 로그인 화면은 position:fixed 라 뷰포트를 통째로 먹는다 — 흐름 안으로 되돌린다
  const login = document.getElementById('loginScreen');
  if (login && okH) {
    login.style.position = 'relative';
    login.style.inset = 'auto';
    login.style.height = h + 'px';
  }
})();

// 시트가 열린 상태를 Pen 에 따로 임포트하려면 그 상태로 뜰 수 있어야 한다.
// (?w=390&h=844&sheet=1) — capture 클래스가 붙은 뒤에 호출해야 스크롤 잠금이 안 걸린다.
if (new URLSearchParams(location.search).get('sheet') === '1') setSheet(true);

applyI18n();
refreshMe();
