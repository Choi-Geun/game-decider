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
    resumeData = null; // 동기화로 진행도가 바뀌었을 수 있으니 다시 계산시킨다
    collectionData = null;
    dailyData = null;  // 동기화가 곧 판정이다 — 고른 도전이 깨졌는지 여기서 드러난다
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
const VIEWS = ['daily', 'spin', 'resume', 'collection', 'games', 'ach', 'friends'];

function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const [view, param] = raw.split('/');
  return { view: VIEWS.includes(view) ? view : 'daily', param: param || null };
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
  if (state.view === 'daily') renderDaily();
  else if (state.view === 'resume') renderResume();
  else if (state.view === 'collection') renderCollection();
  else if (state.view === 'games') renderGames();
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
function renderGames() {
  const q = ($('gameSearch').value || '').toLowerCase();
  const list = state.games
    .filter((g) => g.name.toLowerCase().includes(q))
    .sort((a, b) => (b.playtimeMinutes || 0) - (a.playtimeMinutes || 0));
  $('gameGrid').innerHTML = list.map((g) => {
    const pct = g.ach && g.ach.completionPct;
    const meta = pct != null ? t('completion', { pct }) : (g.playtimeMinutes ? Math.round(g.playtimeMinutes / 60) + t('hours') : '');
    const bar = pct != null ? `<div class="bar"><i style="width:${pct}%"></i></div>` : '';
    return `<div class="game-card" data-appid="${g.appid}"><img src="${imgHeader(g)}" ${coverAttrs(g)}><div class="gc-body"><div class="gc-name">${esc(g.name)}</div><div class="gc-meta">${meta}</div>${bar}</div></div>`;
  }).join('') || `<div class="empty">${t('emptyGroup')}</div>`;
}
$('gameSearch').addEventListener('input', renderGames);
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

  const last = c.lastAchievement
    ? `<div class="rc-row"><span class="rc-label">${t('resumeLastAch')}</span>
         <span class="rc-ach">${esc(c.lastAchievement.name)}</span>
         <span class="rc-date">${fmtDate(c.lastAchievement.unlockTime)}</span></div>`
    : '';

  const next = c.nextAchievement
    ? `<div class="rc-row rc-next"><span class="rc-label">${t('resumeNextAch')}</span>
         <span class="rc-nextbody">
           <span class="rc-ach">${esc(c.nextAchievement.name)}</span>
           <span class="rc-sub">${t('resumePlayers', { p: Math.round(c.nextAchievement.globalPercent) })}</span>
         </span></div>`
    : '';

  const notes = [];
  if (c.burstCount >= 3) notes.push(t('resumeReturns', { n: c.burstCount }));
  if (c.unlockPaceMinutes != null) notes.push(t('resumePace', { m: c.unlockPaceMinutes }));

  return `<article class="resume-card" data-appid="${c.appid}">
    ${cover}
    <div class="rc-body">
      <div class="rc-head">
        <h3 class="rc-name">${esc(c.name)}</h3>
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
  if (!resumeData) { box.innerHTML = `<div class="empty">${t('loading')}</div>`; loadResume(); return; }

  const { active = [], dropped = [], droppedTotal = 0 } = resumeData;
  if (!active.length && !dropped.length) { box.innerHTML = `<div class="empty">${t('resumeEmpty')}</div>`; return; }

  let html = '';
  if (active.length) {
    html += `<section class="resume-group"><h3 class="rg-title">${t('resumeActive')}</h3>
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
      <span class="dc-ach">${esc(c.achName)}</span>
      ${c.achDesc ? `<span class="dc-desc">${esc(c.achDesc)}</span>` : ''}
      <span class="dc-game">${esc(c.gameName)}</span>
      <span class="dc-why">${esc(cardWhy(c))}</span>
    </span>
    ${picked
      ? `<span class="dc-actions">
           <a class="dc-play" href="${steamRunUrl(c.appid)}">${t('dailyGo')}</a>
           <span class="dc-note">${t('dailyComeBack')}</span>
         </span>`
      : `<button class="dc-pick" data-pick="${i}">${t('pickThis')}</button>`}
  </article>`;
}

function renderDaily() {
  const box = $('dailyContent');
  if (!box) return;
  if (!dailyData) { box.innerHTML = `<div class="empty">${t('loading')}</div>`; loadDaily(); return; }
  if (dailyData.needsSync) { box.innerHTML = `<div class="empty">${t('dailyNeedSync')}</div>`; return; }

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
    box.innerHTML = doneHtml + `<div class="empty">${t('dailyEmpty')}</div>`;
    return;
  }

  const isPicked = picked != null;
  const shown = isPicked ? [cards[picked.index]] : cards;

  const head = `<div class="daily-head">
    <h2>${t('dailyTitle')}</h2>
    <span class="daily-stats">${t('statsDone', { n: stats.done || 0 })}</span>
  </div>
  <p class="view-lead">${isPicked ? t('dailyPickedLead') : t('dailyLead')}</p>`;

  const deck = `<div class="draw-deck${isPicked ? ' single' : ''}">
    ${shown.map((c, i) => drawCardHtml(c, isPicked ? picked.index : i, isPicked)).join('')}
  </div>`;

  // 재뽑기는 하루 1회. 선택 전이면 '다시 뽑기', 선택 후면 '접고 다시 뽑기'.
  const foot = rerollAvailable
    ? `<div class="daily-foot"><button class="daily-reroll" data-act="${isPicked ? 'giveup' : 'reroll'}">
        ${isPicked ? t('giveUpBtn') : t('rerollBtn')}</button></div>`
    : `<div class="daily-foot"><span class="daily-note">${t('rerollUsed')}</span></div>`;

  const recentHtml = recent.length
    ? `<section class="coll-block"><h3 class="cb-title">${t('recentDone')}</h3>
        <div class="hscroll">${recent.map((h) => trophyCard({
          appid: h.appid, gameName: h.gameName, images: h.images, name: h.achName,
          globalPercent: h.globalPercent, tier: h.tier,
        })).join('')}</div></section>`
    : '';

  box.innerHTML = doneHtml + head + deck + foot + recentHtml;
}

$('dailyContent').addEventListener('click', (e) => {
  const pickBtn = e.target.closest('[data-pick]');
  if (pickBtn) return dailyAction('/api/draw/pick', { index: Number(pickBtn.dataset.pick) });
  const act = e.target.closest('[data-act]');
  if (act) return dailyAction('/api/draw/' + act.dataset.act);
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
  if (state.view === 'collection') renderCollection();
}

// 2.1% 보다 "1000명 중 21명"이 훨씬 와닿는다.
const perThousand = (pct) => Math.max(1, Math.round(pct * 10));

// 등급은 색만으로 구분하면 안 들어온다. 항상 글자 배지를 같이 단다.
const TIER_ICON = { legendary: '🏆', rare: '💎', normal: '🔹', common: '·' };
function tierBadge(tier) {
  const key = 'tier' + tier.charAt(0).toUpperCase() + tier.slice(1);
  return `<span class="tier-badge t-${tier}">${TIER_ICON[tier]} ${t(key)}</span>`;
}

// 텍스트만 있으면 "뭘 보라는 건데?"가 된다. 트로피에도 게임 아트를 붙인다.
function trophyCard(a) {
  const g = { appid: a.appid, name: a.gameName, images: a.images };
  return `<a class="trophy-card t-${a.tier}" href="#games/${a.appid}" title="${esc(a.name)} — ${esc(a.gameName)}">
    <span class="tc-art"><img src="${imgHeader(g)}" ${coverAttrs(g)}></span>
    <span class="tc-badge">${tierBadge(a.tier)}</span>
    <span class="tc-body">
      <span class="tc-pct">${a.globalPercent}%</span>
      <span class="tc-name">${esc(a.name)}</span>
      <span class="tc-game">${esc(a.gameName)}</span>
    </span>
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
      <span class="gc-name">${esc(g.name)}</span>
      <span class="gc-pills">${pills.join('')}</span>
      <span class="gc-prog">${t('achCount', { u: g.unlocked, t: g.total })} · ${g.completionPct}%</span>
    </span>
  </a>`;
}

function renderCollection() {
  const box = $('collectionContent');
  if (!box) return;
  if (!collectionData) { box.innerHTML = `<div class="empty">${t('loading')}</div>`; loadCollection(); return; }

  const { counts, crown, showcase, games, nextTargets, harvest } = collectionData;
  if (!crown) { box.innerHTML = `<div class="empty">${t('collectionEmpty')}</div>`; return; }

  // 등급 인덱스 — 색만으로는 안 들어온다. 기준을 글자로 못박는다.
  const tiles = [
    { key: 'legendary', n: counts.legendary },
    { key: 'rare', n: counts.rare },
  ].map((x) => `<div class="tier-tile t-${x.key}">
      <span class="tt-head">${TIER_ICON[x.key]} ${t('tier' + x.key.charAt(0).toUpperCase() + x.key.slice(1))}</span>
      <span class="tt-n">${x.n}</span>
      <span class="tt-desc">${t(x.key === 'legendary' ? 'tierLegendaryDesc' : 'tierRareDesc')}</span>
    </div>`).join('');
  const tilesHtml = `<div class="tier-row">${tiles}
    <div class="tier-tile t-total"><span class="tt-head">${t('tierTotal')}</span>
      <span class="tt-n">${counts.total}</span><span class="tt-desc">&nbsp;</span></div>
  </div>`;

  // 왕관 — 최고 기록 하나는 여전히 크게 세운다
  const crownHtml = `<section class="crown-card">
    <img class="crown-art" src="${imgHeader(crown)}" data-fallback="${esc(crown.gameName)}">
    <div class="crown-body">
      <span class="crown-badge">${tierBadge(crown.tier)}<span class="crown-label">${t('crownLabel')}</span></span>
      <div class="crown-pct">${crown.globalPercent}%</div>
      <h3 class="crown-name">${esc(crown.name)}</h3>
      <div class="crown-game">${esc(crown.gameName)}${crown.unlockTime ? ` · ${fmtDate(crown.unlockTime)}` : ''}</div>
      <div class="crown-note">${t('crownOutOf', { n: perThousand(crown.globalPercent) })}</div>
    </div>
  </section>`;

  // 트로피 진열 — 가로 스크롤. 각 카드에 게임 아트 + 등급 배지
  const shelf = showcase.length
    ? `<section class="coll-block">
        <h3 class="cb-title">${t('trophyShelf')}<span class="cb-sub">${t('trophyShelfLead')}</span></h3>
        <div class="hscroll">${showcase.map(trophyCard).join('')}</div>
      </section>`
    : '';

  // 게임별 현황 — "내 다른 게임들은 어떤 상태인지"
  const gamesHtml = `<section class="coll-block">
    <h3 class="cb-title">${t('gameShelf')}<span class="cb-sub">${t('gameShelfLead')}</span></h3>
    ${games && games.length
      ? `<div class="hscroll">${games.map(gameCollectionCard).join('')}</div>`
      : `<div class="empty">${t('gameShelfEmpty')}</div>`}
  </section>`;

  // 앞으로 향하게 하는 유일한 장치. 이게 없으면 수집함은 과거 기록일 뿐이다.
  const nextHtml = nextTargets.length
    ? `<section class="coll-block">
        <h3 class="cb-title">${t('nextTargetTitle', { n: counts.legendary + 1 })}</h3>
        <p class="cb-lead">${t('nextTargetLead')}</p>
        <div class="target-list">${nextTargets.map((x) => {
          const g = { appid: x.appid, name: x.gameName, images: x.images };
          return `<div class="target">
            <img class="tg-art" src="${imgHeader(g)}" ${coverAttrs(g)}>
            <span class="tg-pct t-legendary">${x.globalPercent}%</span>
            <span class="tg-body">
              <span class="tg-name">${esc(x.name)}</span>
              <span class="tg-game">${esc(x.gameName)} · ${t('nextTargetPlayed', { h: Math.round(x.playtimeMinutes / 60) })}</span>
            </span>
            <a class="tg-go" href="${steamRunUrl(x.appid)}">▶ ${t('challenge')}</a>
          </div>`;
        }).join('')}</div>
      </section>`
    : '';

  const harvestHtml = `<section class="coll-block">
    <h3 class="cb-title">${t('harvestTitle', { d: harvest.days })}
      <span class="cb-sub">${harvest.count ? t('collectionCount', { n: harvest.count }) + (harvest.rarest ? ' · ' + t('harvestRarest', { p: harvest.rarest.globalPercent }) : '') : ''}</span></h3>
    ${harvest.count
      ? `<div class="hscroll">${harvest.items.map(trophyCard).join('')}</div>`
      : `<div class="empty">${t('harvestNone')}</div>`}
  </section>`;

  box.innerHTML = tilesHtml + crownHtml + shelf + gamesHtml + nextHtml + harvestHtml;
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
    `<a class="dlc-item" href="https://store.steampowered.com/app/${x.appid}" target="_blank" rel="noopener"><img src="${esc(x.header)}" data-fallback="${esc(x.name)}"><span class="dlc-name">${esc(x.name)}</span>${x.price ? `<span class="dlc-price">${esc(x.price)}</span>` : ''}</a>`
  ).join('') + `</div>` + (d.dlcTotal > dlc.length ? `<div class="gh-sub" style="margin-top:8px">${t('dDlcMore', { n: d.dlcTotal - dlc.length })}</div>` : '') : `<div class="empty">${t('dNoDlc')}</div>`;
  const dlcCard = `<div class="d-card"><h3>🧩 ${t('dDlc')}</h3>${dlcInner}</div>`;

  const cachedNote = d.cachedAt ? `<span class="muted" style="color:var(--muted);font-size:11px;margin-left:8px">· ${t('dCached')} ${fmtDate(Math.floor(d.cachedAt / 1000))}</span>` : '';

  $('gameDetail').innerHTML =
    `<button class="detail-back" id="detailBack">${t('back')}</button>` +
    `<div class="detail-hero"><img src="${esc(hero)}" data-fallback="${esc(name)}"><div class="dh-shade"></div><div class="dh-body"><h2>${esc(name)}${cachedNote}</h2><div class="detail-meta">${meta.map((m) => `<span>${m}</span>`).join('')}</div></div></div>` +
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
    `<a class="chip" href="${steamRunUrl(g.appid)}"><img src="${imgHeader(g)}" ${coverAttrs(g)}>${esc(g.name)}<span class="pct">${g.ach.completionPct}%</span></a>`
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
    return `<details class="game-acc"><summary><img src="${imgHeader(g)}" ${coverAttrs(g)}><span class="ga-name">${esc(g.name)}</span><span class="ga-pct">${t('achCount', { u: g.ach.unlocked, t: g.ach.total })} · ${g.ach.completionPct}%</span></summary><div class="ga-body">${rows}</div></details>`;
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
    return `<div class="friend-game"><img class="fg-img" src="${img}" ${coverAttrs(g)}><div class="fg-body"><div class="fg-top"><span class="fg-name">${esc(g.name)}</span> <span class="fg-tag">${tag}</span><a class="fg-play" href="${steamRunUrl(g.appid)}">▶ ${t('play')}</a></div><div class="owners">${owners}</div></div></div>`;
  }).join('');
}

// ── 시작 ──────────────────────────────────────────────────────────
applyI18n();
refreshMe();
