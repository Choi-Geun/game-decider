// 화면 로직 — 선택값을 모아 window.api.recommend() 를 호출하고 결과를 그린다.
const state = { mood: 'relaxed', time: 'medium', players: 'solo' };
let rollCount = 0;
let lastPick = null;

// 옵션 버튼 토글
document.querySelectorAll('.opts').forEach((group) => {
  const key = group.dataset.group;
  group.querySelectorAll('.opt').forEach((opt) => {
    if (opt.dataset.value === state[key]) opt.classList.add('active');
    opt.addEventListener('click', () => {
      group.querySelectorAll('.opt').forEach((o) => o.classList.remove('active'));
      opt.classList.add('active');
      state[key] = opt.dataset.value;
    });
  });
});

// 설치된 게임 개수 표시
async function refreshCount() {
  const games = await window.api.getGames();
  document.getElementById('count').textContent = `설치된 게임 ${games.length}개 인식됨`;
}
refreshCount();

async function roll() {
  const input = {
    mood: state.mood,
    time: state.time,
    players: state.players,
    backlogOnly: document.getElementById('backlog').checked,
    _roll: rollCount,
  };
  const res = await window.api.recommend(input);
  const result = document.getElementById('result');
  if (!res.game) {
    document.getElementById('pickName').textContent = '게임을 못 찾았어요';
    document.getElementById('pickReason').textContent = res.reason || '';
    result.classList.add('show');
    return;
  }
  lastPick = res.game;
  document.getElementById('badge').textContent = res.source === 'ai' ? 'AI 추천' : '추천';
  document.getElementById('pickName').textContent = res.game.name;
  document.getElementById('pickReason').textContent = res.reason;
  result.classList.add('show');
}

document.getElementById('roll').addEventListener('click', () => { rollCount = 0; roll(); });
document.getElementById('again').addEventListener('click', () => { rollCount += 1; roll(); });
document.getElementById('play').addEventListener('click', () => {
  if (lastPick) window.api.launchGame(lastPick.appid);
});

// ── v0.2: Steam 로그인 / 동기화 / 도전과제 추천 ─────────────────────
let plusMode = 'continue';
let achPick = null;

function fmtTime(unix) {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function showProfile(status) {
  if (!status || !status.steamId) return;
  document.getElementById('login').style.display = 'none';
  document.getElementById('profile').style.display = 'flex';
  if (status.profile) {
    document.getElementById('avatar').src = status.profile.avatar || '';
    document.getElementById('pname').textContent = status.profile.name || status.steamId;
  } else {
    document.getElementById('pname').textContent = status.steamId;
  }
  document.getElementById('synced').textContent = status.updatedAt
    ? `동기화됨: ${fmtTime(status.updatedAt)} · 게임 ${status.count || 0}개`
    : '아직 동기화 안 됨 → 🔄 눌러주세요';
  if (status.hasCache) {
    document.getElementById('achSection').style.display = 'block';
    loadAchRecommend();
  }
}

document.getElementById('login').addEventListener('click', async () => {
  document.getElementById('login').textContent = '로그인 창 확인 중...';
  try {
    const res = await window.api.steamLogin();
    showProfile(res);
  } catch (e) {
    document.getElementById('login').textContent = '🔑 Steam으로 로그인 (실패, 재시도)';
  }
});

document.getElementById('sync').addEventListener('click', async () => {
  const prog = document.getElementById('progress');
  prog.style.display = 'block';
  prog.textContent = '동기화 시작...';
  const res = await window.api.steamSync();
  if (!res.ok) {
    prog.textContent = '❌ ' + res.error;
    return;
  }
  prog.textContent = `✅ 완료 — 게임 ${res.count}개`;
  const status = await window.api.steamStatus();
  showProfile(status);
});

window.api.onSyncProgress((d) => {
  document.getElementById('progress').textContent = `동기화 중... ${d.done}/${d.total} — ${d.name}`;
});

// 도전과제 추천 모드 버튼
const plusGroup = document.querySelector('[data-group="plusmode"]');
if (plusGroup) {
  plusGroup.querySelectorAll('.opt').forEach((opt) => {
    opt.addEventListener('click', () => {
      plusGroup.querySelectorAll('.opt').forEach((o) => o.classList.remove('active'));
      opt.classList.add('active');
      plusMode = opt.dataset.value;
      loadAchRecommend();
    });
  });
}

async function loadAchRecommend() {
  const res = await window.api.recommendPlus(plusMode);
  const box = document.getElementById('achResult');
  if (!res.game) {
    document.getElementById('achName').textContent = '추천할 게 없어요';
    document.getElementById('achReason').textContent = res.reason || '';
    document.getElementById('achList').innerHTML = '';
    box.classList.add('show');
    return;
  }
  achPick = res.game;
  document.getElementById('achName').textContent = res.game.name;
  document.getElementById('achReason').textContent = res.reason;
  document.getElementById('achList').innerHTML = (res.nextAchievements || [])
    .map(
      (a) =>
        `<div class="ach-item"><div class="an">🏅 ${a.name}</div>` +
        `<div class="ad">${a.description || ''}</div>` +
        `<div class="ap">${a.globalPercent != null ? '전역 달성률 ' + a.globalPercent + '%' : ''}</div></div>`
    )
    .join('');
  box.classList.add('show');
}

document.getElementById('achPlay').addEventListener('click', () => {
  if (achPick) window.api.launchGame(achPick.appid);
});

// 앱 시작 시 이전 로그인 상태 확인
(async () => {
  const status = await window.api.steamStatus();
  if (status && status.steamId) showProfile(status);
})();
