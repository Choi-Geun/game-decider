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

const state = { me: null, games: [], achievementsBlocked: false, view: 'spin', achGroup: 'status', lastPick: null, didInitialSpin: false };

// ── 언어 전환 ─────────────────────────────────────────────────────
document.querySelectorAll('.lang-switch button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
window.onLangChange = () => {
  renderProfile();
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
  try { me = await fetch('/api/me').then((r) => r.json()); } catch (e) { return; }
  state.me = me;
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
    startSync(false);
    setInterval(() => startSync(false), 20 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') startSync(false); });
  }
}

function renderProfile() {
  const me = state.me;
  if (!me || !me.loggedIn) return;
  if (me.profile) { $('avatar').src = me.profile.avatar || ''; $('pname').textContent = me.profile.name || me.steamId; }
  else $('pname').textContent = me.steamId;
  $('synced').textContent = me.updatedAt ? t('syncedAt', { date: fmtDate(me.updatedAt), n: me.count || 0 }) : t('notSynced');
}

async function loadGames() {
  try {
    const d = await fetch('/api/games').then((r) => r.json());
    state.games = d.games || [];
    state.achievementsBlocked = !!d.achievementsBlocked;
  } catch (e) {}
  renderView();
  // 최초 1회만 자동 스핀 (동기화 후 재호출돼도 다시 안 돎)
  if (state.view === 'spin' && state.games.length && !state.didInitialSpin) {
    state.didInitialSpin = true;
    spin();
  }
}

// ── 동기화 ────────────────────────────────────────────────────────
let syncing = false, autoSetup = false;
function setSyncing(on) {
  syncing = on;
  const btn = $('sync');
  btn.disabled = on;
  btn.classList.toggle('is-syncing', on);
  btn.textContent = on ? t('syncing') : t('sync');
}
async function startSync(full) {
  if (syncing) return;
  setSyncing(true);
  $('progress').classList.remove('hidden');
  $('progress').textContent = full ? t('syncFull') : t('syncChecking');
  try {
    const r = await fetch('/api/sync' + (full ? '?full=1' : ''), { method: 'POST' }).then((x) => x.json());
    if (r.error) { $('progress').textContent = '❌ ' + r.error; setSyncing(false); return; }
    pollProgress();
  } catch (e) { $('progress').textContent = t('syncFail'); setSyncing(false); }
}
async function pollProgress() {
  let p;
  try { p = await fetch('/api/sync/progress').then((r) => r.json()); } catch (e) { setSyncing(false); return; }
  if (p.status === 'running') {
    $('progress').textContent = p.total ? t('syncProgress', { done: p.done, total: p.total, name: p.name || '' }) : t('syncChecking');
    setTimeout(pollProgress, 1000);
  } else if (p.status === 'done') {
    const s = p.stats || {};
    let msg = s.fetched ? t('syncUpdated', { n: s.fetched }) : t('syncLatest');
    if (s.added) msg += ' · ' + t('syncNewGames', { n: s.added });
    $('progress').textContent = msg;
    setSyncing(false);
    refreshMeLight();
    loadGames();
    if (!s.fetched) setTimeout(() => $('progress').classList.add('hidden'), 2500);
  } else if (p.status === 'error') { $('progress').textContent = '❌ ' + (p.error || ''); setSyncing(false); }
  else setSyncing(false);
}
async function refreshMeLight() {
  try { state.me = await fetch('/api/me').then((r) => r.json()); renderProfile(); } catch (e) {}
}
$('sync').addEventListener('click', () => startSync(false));

// ── 네비게이션 (해시 라우팅) ──────────────────────────────────────
// URL 해시가 곧 현재 뷰. 새로고침해도 뷰가 유지되고, 특정 화면을 링크로 공유할 수 있다.
//   #spin | #games | #games/{appid} | #ach | #friends
const VIEWS = ['spin', 'games', 'ach', 'friends'];

function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const [view, param] = raw.split('/');
  return { view: VIEWS.includes(view) ? view : 'spin', param: param || null };
}

// 뷰 전환의 단일 진입점 — 해시가 바뀔 때만 호출된다.
function applyRoute() {
  const { view, param } = parseHash();
  state.view = view;

  document.querySelectorAll('.nav-item').forEach((x) => x.classList.toggle('active', x.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('view-' + view).classList.remove('hidden');

  if (view === 'games') {
    const appid = param ? Number(param) : null;
    if (appid) { if (state.detailAppid !== appid) openDetail(appid); }
    else closeDetail();
  }
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
  if (state.view === 'games') renderGames();
  else if (state.view === 'ach') renderAch();
  else if (state.view === 'friends') renderFriendsIfLoaded();
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
  cf.innerHTML = deck.map((g) => `<div class="cf-card"><img src="${imgPortrait(g)}" onerror="this.onerror=null;this.src='${imgHeader(g)}'"></div>`).join('');
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
function renderGames() {
  const q = ($('gameSearch').value || '').toLowerCase();
  const list = state.games
    .filter((g) => g.name.toLowerCase().includes(q))
    .sort((a, b) => (b.playtimeMinutes || 0) - (a.playtimeMinutes || 0));
  $('gameGrid').innerHTML = list.map((g) => {
    const pct = g.ach && g.ach.completionPct;
    const meta = pct != null ? t('completion', { pct }) : (g.playtimeMinutes ? Math.round(g.playtimeMinutes / 60) + t('hours') : '');
    const bar = pct != null ? `<div class="bar"><i style="width:${pct}%"></i></div>` : '';
    return `<div class="game-card" data-appid="${g.appid}"><img src="${imgHeader(g)}" onerror="this.style.opacity=.12"><div class="gc-body"><div class="gc-name">${esc(g.name)}</div><div class="gc-meta">${meta}</div>${bar}</div></div>`;
  }).join('') || `<div class="empty">${t('emptyGroup')}</div>`;
}
$('gameSearch').addEventListener('input', renderGames);
$('gameGrid').addEventListener('click', (e) => {
  const card = e.target.closest('.game-card');
  if (card && card.dataset.appid) navigate('games/' + card.dataset.appid);
});

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
  box.innerHTML = `<button class="detail-back" id="detailBack">${t('back')}</button><div class="empty">${t('loading')}</div>`;
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
  if (info.metacritic) meta.push(`Metacritic ${info.metacritic}`);
  if (info.price) meta.push(esc(info.price));

  // 진척도 카드
  let progCard = '';
  const ach = pr.ach && pr.ach.hasAchievements ? pr.ach : null;
  const played = pr.playtimeMinutes ? t('dPlaytime', { h: Math.round(pr.playtimeMinutes / 60) }) : t('dNever');
  const lastP = pr.lastPlayed ? fmtDate(pr.lastPlayed) : '-';
  let progInner = `<div class="d-kv"><b>${played}</b></div><div class="d-kv">${t('dLastPlayed')}: <b>${lastP}</b></div>`;
  if (ach) {
    progInner += `<div class="d-prog-bar"><i style="width:${ach.completionPct}%"></i></div><div class="d-kv">${t('achCount', { u: ach.unlocked, t: ach.total })} · ${ach.completionPct}%</div>`;
    if (pr.lastAchievement) progInner += `<div class="d-kv">${t('dLastAch')}: <b>🏅 ${esc(pr.lastAchievement.name)}</b> <span style="color:var(--muted)">(${fmtDate(pr.lastAchievement.unlockTime)})</span></div>`;
  }
  progCard = `<div class="d-card"><h3>📊 ${t('dProgress')}</h3>${progInner}</div>`;

  // 평가 카드
  let revCard = '';
  const rv = d.reviews;
  if (rv && rv.total_reviews) {
    const posPct = Math.round((rv.total_positive / rv.total_reviews) * 100);
    revCard = `<div class="d-card"><h3>⭐ ${t('dReviews')}</h3><div class="review-badge review-pos">${esc(rv.review_score_desc || '')}</div><div class="d-kv" style="margin-top:10px">${t('dReviewCount', { n: rv.total_reviews.toLocaleString(), p: posPct })}</div></div>`;
  } else {
    revCard = `<div class="d-card"><h3>⭐ ${t('dReviews')}</h3><div class="empty">${t('dNoReviews')}</div></div>`;
  }

  // 도전과제 카드 (달성/미달성)
  let achCard = '';
  if (ach) {
    const unlocked = ach.achievements.filter((a) => a.achieved).sort((a, b) => (b.unlockTime || 0) - (a.unlockTime || 0));
    const locked = ach.achievements.filter((a) => !a.achieved).sort((a, b) => (b.globalPercent || 0) - (a.globalPercent || 0));
    achCard = `<div class="d-card" style="grid-column:1/-1"><h3>🏆 ${t('navAch')} <span class="muted">${ach.unlocked}/${ach.total}</span></h3><div class="d-ach-cols"><div><div class="gh-sub">${t('dAchUnlocked')} (${unlocked.length})</div>${achListHtml(unlocked)}</div><div><div class="gh-sub">${t('dAchLocked')} (${locked.length})</div>${achListHtml(locked)}</div></div></div>`;
  } else {
    achCard = `<div class="d-card" style="grid-column:1/-1"><h3>🏆 ${t('navAch')}</h3><div class="empty">${t('dNoAch')}</div></div>`;
  }

  // 뉴스 카드
  const news = d.news || [];
  const newsInner = news.length ? news.map((n) =>
    `<div class="news-item"><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="n-date">${fmtDate(n.date)}${n.feedlabel ? ' · ' + esc(n.feedlabel) : ''}</div></div>`
  ).join('') : `<div class="empty">${t('dNoNews')}</div>`;
  const newsCard = `<div class="d-card"><h3>📰 ${t('dNews')}</h3>${newsInner}</div>`;

  // DLC 카드
  const dlc = d.dlc || [];
  const dlcInner = dlc.length ? `<div class="dlc-grid">` + dlc.map((x) =>
    `<a class="dlc-item" href="https://store.steampowered.com/app/${x.appid}" target="_blank" rel="noopener"><img src="${esc(x.header)}" onerror="this.style.opacity=.15"><span class="dlc-name">${esc(x.name)}</span>${x.price ? `<span class="dlc-price">${esc(x.price)}</span>` : ''}</a>`
  ).join('') + `</div>` + (d.dlcTotal > dlc.length ? `<div class="gh-sub" style="margin-top:8px">${t('dDlcMore', { n: d.dlcTotal - dlc.length })}</div>` : '') : `<div class="empty">${t('dNoDlc')}</div>`;
  const dlcCard = `<div class="d-card"><h3>🧩 ${t('dDlc')}</h3>${dlcInner}</div>`;

  const cachedNote = d.cachedAt ? `<span class="muted" style="color:var(--muted);font-size:11px;margin-left:8px">· ${t('dCached')} ${fmtDate(Math.floor(d.cachedAt / 1000))}</span>` : '';

  $('gameDetail').innerHTML =
    `<button class="detail-back" id="detailBack">${t('back')}</button>` +
    `<div class="detail-hero"><img src="${esc(hero)}" onerror="this.style.opacity=.2"><div class="dh-shade"></div><div class="dh-body"><h2>${esc(name)}${cachedNote}</h2><div class="detail-meta">${meta.map((m) => `<span>${m}</span>`).join('')}</div></div></div>` +
    `<div class="detail-actions"><a class="d-play" href="${steamRunUrl(appid)}">${t('dPlay')}</a><a class="d-steam" href="https://store.steampowered.com/app/${appid}" target="_blank" rel="noopener">${t('dSteam')}</a></div>` +
    (info.shortDescription ? `<div class="detail-desc">${esc(info.shortDescription)}</div>` : '') +
    `<div class="detail-grid">${progCard}${revCard}${achCard}${newsCard}${dlcCard}</div>`;
  $('detailBack').onclick = () => navigate('games');
}

// ── 도전과제 ──────────────────────────────────────────────────────
document.querySelectorAll('.subtab').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.subtab').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  state.achGroup = b.dataset.group;
  renderAch();
}));

function withAchGames() {
  return state.games.filter((g) => g.ach && g.ach.hasAchievements && g.ach.total > 0);
}
function renderAch() {
  $('achWarn').classList.toggle('hidden', !state.achievementsBlocked);
  const games = withAchGames();
  if (!games.length) { $('achContent').innerHTML = `<div class="empty">${t('noAchGames')}</div>`; return; }
  if (state.achGroup === 'status') renderAchStatus(games);
  else if (state.achGroup === 'rarity') renderAchRarity(games);
  else renderAchByGame(games);
}
function gameChips(games) {
  if (!games.length) return `<div class="empty">${t('emptyGroup')}</div>`;
  return `<div class="chip-row">` + games.map((g) =>
    `<a class="chip" href="${steamRunUrl(g.appid)}"><img src="${imgHeader(g)}">${esc(g.name)}<span class="pct">${g.ach.completionPct}%</span></a>`
  ).join('') + `</div>`;
}
function achGroupBox(title, sub, inner) {
  return `<div class="ach-group"><h3>${esc(title)}</h3><div class="gh-sub">${esc(sub)}</div>${inner}</div>`;
}
function renderAchStatus(games) {
  const remaining = (g) => g.ach.achievements.filter((a) => !a.achieved);
  const cont = games.filter((g) => g.ach.completionPct < 100 && ((g.playtime2weeks || 0) > 0 || (g.lastPlayed || 0) > 0))
    .sort((a, b) => (b.playtime2weeks || 0) - (a.playtime2weeks || 0) || (b.lastPlayed || 0) - (a.lastPlayed || 0)).slice(0, 24);
  const finish = games.filter((g) => g.ach.completionPct >= 50 && g.ach.completionPct < 100)
    .sort((a, b) => b.ach.completionPct - a.ach.completionPct).slice(0, 24);
  const easy = games.filter((g) => remaining(g).some((a) => a.globalPercent != null && a.globalPercent >= 40)).slice(0, 24);
  const rare = games.filter((g) => remaining(g).some((a) => a.globalPercent != null && a.globalPercent <= 10)).slice(0, 24);
  $('achContent').innerHTML =
    achGroupBox(t('stContinue'), t('stContinueSub'), gameChips(cont)) +
    achGroupBox(t('stFinish'), t('stFinishSub'), gameChips(finish)) +
    achGroupBox(t('stEasy'), t('stEasySub'), gameChips(easy)) +
    achGroupBox(t('stRare'), t('stRareSub'), gameChips(rare));
}
function tierOf(pct) { return pct <= 5 ? 'diamond' : pct <= 20 ? 'gold' : pct <= 50 ? 'silver' : 'bronze'; }
function renderAchRarity(games) {
  const locked = [];
  games.forEach((g) => g.ach.achievements.forEach((a) => {
    if (!a.achieved && a.globalPercent != null) locked.push({ name: a.name, desc: a.description, pct: a.globalPercent, game: g.name });
  }));
  const tiers = { diamond: [], gold: [], silver: [], bronze: [] };
  locked.forEach((a) => tiers[tierOf(a.pct)].push(a));
  const order = [['diamond', 'tierDiamond', 'tier-diamond'], ['gold', 'tierGold', 'tier-gold'], ['silver', 'tierSilver', 'tier-silver'], ['bronze', 'tierBronze', 'tier-bronze']];
  let html = `<div class="gh-sub" style="margin-bottom:12px">${t('rarityLockedNote')}</div>`;
  for (const [key, label, cls] of order) {
    const arr = tiers[key].sort((a, b) => a.pct - b.pct);
    const shown = arr.slice(0, 60);
    const rows = shown.map((a) =>
      `<div class="ach-row locked"><div><div class="a-name">${esc(a.name)}</div><div class="a-desc">${esc(a.game)}</div></div><div class="a-pct">${a.pct.toFixed(1)}%</div></div>`
    ).join('') || `<div class="empty">${t('emptyGroup')}</div>`;
    const more = arr.length > 60 ? `<div class="gh-sub" style="margin-top:8px">+${arr.length - 60}</div>` : '';
    html += `<div class="ach-group"><h3><span class="tier-badge ${cls}">${t(label)}</span> · ${arr.length}</h3>${rows}${more}</div>`;
  }
  $('achContent').innerHTML = html;
}
function renderAchByGame(games) {
  const sorted = [...games].sort((a, b) => (b.ach.completionPct || 0) - (a.ach.completionPct || 0));
  $('achContent').innerHTML = sorted.map((g) => {
    const rows = [...g.ach.achievements]
      .sort((a, b) => Number(b.achieved) - Number(a.achieved))
      .map((a) => `<div class="ach-row ${a.achieved ? '' : 'locked'}"><div><div class="a-name">${a.achieved ? '🏅 ' : '🔒 '}${esc(a.name)}</div><div class="a-desc">${esc(a.description)}</div></div><div class="a-pct">${a.globalPercent != null ? a.globalPercent.toFixed(1) + '%' : ''}</div></div>`)
      .join('');
    return `<details class="game-acc"><summary><img src="${imgHeader(g)}"><span class="ga-name">${esc(g.name)}</span><span class="ga-pct">${t('achCount', { u: g.ach.unlocked, t: g.ach.total })} · ${g.ach.completionPct}%</span></summary><div class="ga-body">${rows}</div></details>`;
  }).join('');
}

// ── 친구 코옵 ─────────────────────────────────────────────────────
let friendLoading = false, friendData = null;
$('friendBtn').addEventListener('click', loadFriends);
function renderFriendsIfLoaded() { if (friendData) renderFriends(friendData); }
async function loadFriends() {
  if (friendLoading) return;
  friendLoading = true;
  $('friendBtn').disabled = true;
  $('friendProgress').classList.remove('hidden');
  $('friendProgress').textContent = t('friendChecking');
  try { friendData = await fetch('/api/friends').then((r) => r.json()); renderFriends(friendData); }
  catch (e) { $('friendProgress').textContent = t('friendFail'); }
  $('friendBtn').disabled = false;
  friendLoading = false;
}
function renderFriends(res) {
  const list = $('friendList');
  if (res.error) { $('friendProgress').textContent = '❌ ' + res.error; return; }
  if (res.privateFriendList || res.friendCount === 0) { $('friendProgress').textContent = t('friendPrivate'); list.innerHTML = ''; return; }
  if (!res.games || !res.games.length) { $('friendProgress').textContent = t('friendNoCoop', { n: res.friendCount }); list.innerHTML = ''; return; }
  $('friendProgress').textContent = t('friendSummary', { n: res.friendCount, p: res.publicFriends, g: res.games.length });
  list.innerHTML = res.games.map((g) => {
    const tag = g.coop ? t('coop') : t('multi');
    const img = (g.images && g.images.header) || imgHeader(g);
    const owners = g.owners.map((o) => {
      const av = o.avatar ? `<img src="${o.avatar}">` : '';
      const playing = o.playingThis ? ` <span class="playing">${t('playingNow')}</span>` : o.inGameName ? ` <span class="playing">(${esc(o.inGameName)})</span>` : '';
      return `<span class="owner ${o.online ? 'on' : ''}"><span class="dot"></span>${av}${esc(o.name)}${playing}</span>`;
    }).join('');
    return `<div class="friend-game"><img class="fg-img" src="${img}" onerror="this.style.display='none'"><div class="fg-body"><div class="fg-top"><span class="fg-name">${esc(g.name)}</span> <span class="fg-tag">${tag}</span><a class="fg-play" href="${steamRunUrl(g.appid)}">▶ ${t('play')}</a></div><div class="owners">${owners}</div></div></div>`;
  }).join('');
}

// ── 시작 ──────────────────────────────────────────────────────────
applyI18n();
refreshMe();
