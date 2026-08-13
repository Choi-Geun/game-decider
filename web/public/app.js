// ── 유틸 ──────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const steamRunUrl = (appid) => `steam://run/${appid}`;
const imgHeader = (g) => (g.images && g.images.header) || `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fmtDate(unix) {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const state = { me: null, games: [], achievementsBlocked: false, view: 'spin', achGroup: 'status', lastPick: null };

// ── 언어 전환 ─────────────────────────────────────────────────────
document.querySelectorAll('.lang-switch button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
window.onLangChange = () => {
  renderProfile();
  renderView();
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
  if (state.view === 'spin' && state.games.length && !state.lastPick) spin();
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

// ── 네비게이션 ────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  state.view = b.dataset.view;
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('view-' + state.view).classList.remove('hidden');
  renderView();
  if (state.view === 'spin' && state.games.length && !state.lastPick) spin();
}));

function renderView() {
  if (state.view === 'games') renderGames();
  else if (state.view === 'ach') renderAch();
  else if (state.view === 'friends') renderFriendsIfLoaded();
}

// ── 슬롯 스핀 ─────────────────────────────────────────────────────
function pickReason(g) {
  const pt = g.playtimeMinutes || 0;
  const pct = g.ach && g.ach.completionPct;
  if (pt === 0) return t('reasonNever');
  if (pct != null && pct >= 50 && pct < 100) return t('reasonFinish', { pct });
  if ((g.playtime2weeks || 0) > 0) return t('reasonRecent');
  if (pt >= 6000) return t('reasonFav', { hours: Math.round(pt / 60) });
  if (pt < 120) return t('reasonBacklog', { hours: Math.max(1, Math.round(pt / 60)) });
  return t('reasonDefault');
}
function showPick(g) {
  if (!g) { $('pickName').textContent = ''; $('pickReason').textContent = t('spinNeedGames'); $('pick').classList.add('show'); return; }
  state.lastPick = g;
  $('pickName').textContent = g.name;
  $('pickReason').textContent = pickReason(g);
  $('pickPlay').href = steamRunUrl(g.appid);
  $('pick').classList.add('show');
}
function spin() {
  if (!state.games.length) { showPick(null); return; }
  const chosen = state.games[Math.floor(Math.random() * state.games.length)];
  const LEN = 45, LAND = 38;
  const track = $('reelTrack');
  let html = '';
  for (let i = 0; i < LEN; i++) {
    const g = i === LAND ? chosen : state.games[Math.floor(Math.random() * state.games.length)];
    html += `<div class="reel-card${i === LAND ? ' win' : ''}"><img src="${imgHeader(g)}" onerror="this.style.opacity=.12"></div>`;
  }
  track.innerHTML = html;
  track.style.transition = 'none';
  track.style.transform = 'translateX(0)';
  void track.offsetWidth;
  const viewport = track.parentElement;
  const landEl = track.children[LAND];
  const target = viewport.clientWidth / 2 - (landEl.offsetLeft + landEl.offsetWidth / 2);
  $('reroll').disabled = true;
  $('pick').classList.remove('show');
  track.style.transition = 'transform 3s cubic-bezier(.12,.72,.16,1)';
  track.style.transform = `translateX(${target}px)`;
  const done = () => { track.removeEventListener('transitionend', done); $('reroll').disabled = false; showPick(chosen); };
  track.addEventListener('transitionend', done);
}
$('reroll').addEventListener('click', spin);

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
    return `<a class="game-card" href="${steamRunUrl(g.appid)}"><img src="${imgHeader(g)}" onerror="this.style.opacity=.12"><div class="gc-body"><div class="gc-name">${esc(g.name)}</div><div class="gc-meta">${meta}</div>${bar}</div></a>`;
  }).join('') || `<div class="empty">${t('emptyGroup')}</div>`;
}
$('gameSearch').addEventListener('input', renderGames);

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
