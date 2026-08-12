// 웹 프론트엔드 로직 — 백엔드 API를 fetch로 호출.
const state = { mood: 'relaxed', time: 'medium', players: 'solo' };
let plusMode = 'continue';
let rollCount = 0;
let lastPick = null;
let achPick = null;

const $ = (id) => document.getElementById(id);
const steamRunUrl = (appid) => `steam://run/${appid}`;

function fmtDate(unix) {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 옵션 버튼 토글 (기분/시간/인원)
document.querySelectorAll('.opts[data-group]').forEach((group) => {
  const key = group.dataset.group;
  group.querySelectorAll('.opt').forEach((opt) => {
    opt.addEventListener('click', () => {
      group.querySelectorAll('.opt').forEach((o) => o.classList.remove('active'));
      opt.classList.add('active');
      if (key === 'plusmode') {
        plusMode = opt.dataset.value;
        loadAchRecommend();
      } else {
        state[key] = opt.dataset.value;
      }
    });
  });
});

// ── 로그인 (팝업 새 창) ───────────────────────────────────────────
let loginWin = null;
let loginPoll = null;

function openLogin() {
  const w = 800, h = 700;
  const left = window.screenX + (window.outerWidth - w) / 2;
  const top = window.screenY + (window.outerHeight - h) / 2;
  loginWin = window.open(
    '/auth/steam',
    'steamLogin',
    `width=${w},height=${h},left=${left},top=${top}`
  );
  // 팝업 차단 시 대비: 같은 탭 이동으로 폴백
  if (!loginWin) {
    location.href = '/auth/steam';
    return;
  }
  $('login').textContent = '로그인 창 확인 중...';
  // 로그인 완료를 폴링으로 감지 (postMessage 실패해도 동작)
  clearInterval(loginPoll);
  loginPoll = setInterval(async () => {
    let me;
    try { me = await fetch('/api/me').then((r) => r.json()); } catch (e) { return; }
    if (me.loggedIn) {
      clearInterval(loginPoll);
      if (loginWin && !loginWin.closed) loginWin.close();
      refreshMe();
    } else if (loginWin && loginWin.closed) {
      // 사용자가 로그인 안 하고 창을 닫음
      clearInterval(loginPoll);
      $('login').textContent = '🔑 Steam으로 로그인';
    }
  }, 1200);
}

// 팝업에서 오는 알림(빠른 반응용). 실제 갱신은 폴링이 보장.
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'steam-login' && e.data.success) {
    if (loginWin && !loginWin.closed) loginWin.close();
    refreshMe();
  }
});

document.getElementById('login').addEventListener('click', openLogin);

// ── 로그인 상태 확인 ──────────────────────────────────────────────
async function refreshMe() {
  const me = await fetch('/api/me').then((r) => r.json());
  if (!me.loggedIn) {
    $('loginHint').classList.remove('hidden');
    $('moodArea').classList.add('hidden');
    return;
  }
  $('login').classList.add('hidden');
  $('profile').classList.remove('hidden');
  $('loginHint').classList.add('hidden');
  if (me.profile) {
    $('avatar').src = me.profile.avatar || '';
    $('pname').textContent = me.profile.name || me.steamId;
  } else {
    $('pname').textContent = me.steamId;
  }
  $('synced').textContent = me.updatedAt
    ? `동기화됨: ${fmtDate(me.updatedAt)} · 게임 ${me.count}개`
    : '아직 동기화 안 됨 → 🔄 눌러주세요';
  if (me.hasCache) {
    $('moodArea').classList.remove('hidden');
    // 도전과제가 프라이버시로 막혔으면 안내 배너 표시
    $('achWarn').classList.toggle('hidden', !me.achievementsBlocked);
    loadAchRecommend();
  }
}

// ── 동기화 ───────────────────────────────────────────────────────
$('sync').addEventListener('click', async () => {
  $('progress').classList.remove('hidden');
  $('progress').textContent = '동기화 시작...';
  const r = await fetch('/api/sync', { method: 'POST' }).then((x) => x.json());
  if (r.error) {
    $('progress').textContent = '❌ ' + r.error;
    return;
  }
  pollProgress();
});

async function pollProgress() {
  const p = await fetch('/api/sync/progress').then((r) => r.json());
  if (p.status === 'running') {
    $('progress').textContent = `동기화 중... ${p.done}/${p.total} — ${p.name || ''}`;
    setTimeout(pollProgress, 1000);
  } else if (p.status === 'done') {
    $('progress').textContent = `✅ 완료 — 게임 ${p.done}개`;
    refreshMe();
  } else if (p.status === 'error') {
    $('progress').textContent = '❌ ' + (p.error || '실패');
  }
}

$('logout').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  location.reload();
});

// ── 기분 기반 추천 ───────────────────────────────────────────────
async function roll() {
  const q = new URLSearchParams({
    mood: state.mood,
    time: state.time,
    players: state.players,
    backlog: $('backlog').checked ? '1' : '0',
    roll: String(rollCount),
  });
  const res = await fetch('/api/recommend?' + q).then((r) => r.json());
  if (!res.game) {
    $('pickName').textContent = '게임을 못 찾았어요';
    $('pickReason').textContent = res.reason || '';
    $('result').classList.add('show');
    return;
  }
  lastPick = res.game;
  $('badge').textContent = res.source === 'ai' ? 'AI 추천' : '추천';
  $('pickName').textContent = res.game.name;
  $('pickReason').textContent = res.reason;
  $('play').href = steamRunUrl(res.game.appid);
  $('result').classList.add('show');
}
$('roll').addEventListener('click', () => { rollCount = 0; roll(); });
$('again').addEventListener('click', () => { rollCount += 1; roll(); });

// ── 도전과제 추천 ────────────────────────────────────────────────
async function loadAchRecommend() {
  const res = await fetch('/api/recommend-plus?mode=' + plusMode).then((r) => r.json());
  if (!res.game) {
    $('achName').textContent = '추천할 게 없어요';
    $('achReason').textContent = res.reason || '';
    $('achList').innerHTML = '';
    $('achResult').classList.add('show');
    return;
  }
  achPick = res.game;
  $('achName').textContent = res.game.name;
  $('achReason').textContent = res.reason;
  $('achList').innerHTML = (res.nextAchievements || [])
    .map(
      (a) =>
        `<div class="ach-item"><div class="an">🏅 ${a.name}</div>` +
        `<div class="ad">${a.description || ''}</div>` +
        `<div class="ap">${a.globalPercent != null ? '전역 달성률 ' + a.globalPercent + '%' : ''}</div></div>`
    )
    .join('');
  $('achPlay').href = steamRunUrl(res.game.appid);
  $('achResult').classList.add('show');
}

refreshMe();
