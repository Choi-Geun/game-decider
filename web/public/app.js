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

  // 로그인 직후 1회: 자동 동기화(증분) + 주기적 자동 동기화 타이머 (한 번만 세팅)
  if (!autoSetup) {
    autoSetup = true;
    startSync(false); // 캐시 있으면 증분, 없으면 전체
    setInterval(() => startSync(false), PERIODIC_MS);
    // 탭을 다시 볼 때도 한 번 갱신
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') startSync(false);
    });
  }
}

// ── 동기화 (자동 + 주기 + 증분) ───────────────────────────────────
let syncing = false;
let autoSetup = false;
const PERIODIC_MS = 20 * 60 * 1000; // 20분마다 증분 자동 동기화

// 동기화 상태에 따라 버튼 비활성화 + 라벨 변경
function setSyncing(on) {
  syncing = on;
  const btn = $('sync');
  btn.disabled = on;
  btn.classList.toggle('is-syncing', on);
  btn.textContent = on ? '⏳ 동기화 중…' : '🔄 동기화';
}

// full=false: 증분(캐시와 비교해 바뀐 게임만). 캐시 없으면 자동으로 전체.
async function startSync(full) {
  if (syncing) return;
  setSyncing(true);
  $('progress').classList.remove('hidden');
  $('progress').textContent = full ? '전체 동기화 시작...' : '변경사항 확인 중...';
  try {
    const r = await fetch('/api/sync' + (full ? '?full=1' : ''), { method: 'POST' }).then((x) => x.json());
    if (r.error) {
      $('progress').textContent = '❌ ' + r.error;
      setSyncing(false);
      return;
    }
    pollProgress();
  } catch (e) {
    $('progress').textContent = '❌ 동기화 실패';
    setSyncing(false);
  }
}

async function pollProgress() {
  let p;
  try { p = await fetch('/api/sync/progress').then((r) => r.json()); } catch (e) { setSyncing(false); return; }
  if (p.status === 'running') {
    $('progress').textContent = p.total
      ? `동기화 중... ${p.done}/${p.total} — ${p.name || ''}`
      : '변경사항 확인 중...';
    setTimeout(pollProgress, 1000);
  } else if (p.status === 'done') {
    const s = p.stats || {};
    const parts = [s.fetched ? `✅ ${s.fetched}개 갱신` : '✅ 최신 상태'];
    if (s.added) parts.push(`새 게임 ${s.added}`);
    if (s.removed) parts.push(`삭제 ${s.removed}`);
    $('progress').textContent = parts.join(' · ');
    setSyncing(false);
    refreshMe();
    // 잠시 후 상태 메시지 정리 (최신 상태였으면)
    if (!s.fetched) setTimeout(() => $('progress').classList.add('hidden'), 2500);
  } else if (p.status === 'error') {
    $('progress').textContent = '❌ ' + (p.error || '실패');
    setSyncing(false);
  } else {
    setSyncing(false);
  }
}

// 수동 동기화 버튼 (증분)
$('sync').addEventListener('click', () => startSync(false));

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
