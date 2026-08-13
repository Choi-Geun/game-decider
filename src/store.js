// 유저별 앱 상태 저장 — 뽑기·선택·기록.
//
// 지금까지 서버는 무상태였다(HMAC 쿠키에 SteamID만, 세션은 메모리).
// 루프는 "내가 뭘 골랐는지"를 기억해야 하므로 처음으로 영속 상태가 생긴다.
//
// 저장 방식은 cache.js 와 같은 유저별 JSON 파일. 의존성을 늘리지 않는다.
// 쿠키에 담지 않는 이유: 유저가 조작할 수 있으면 판정이 거짓이 될 수 있고,
// 판정의 신뢰가 이 루프의 유일한 자산이다.

const fs = require('fs');
const path = require('path');

const VERSION = 1;
const HISTORY_LIMIT = 100;

function stateFile(dir, steamId) {
  return path.join(dir, `state_${steamId}.json`);
}

function emptyState(steamId) {
  return {
    version: VERSION,
    steamId,
    current: null, // { drawnAt, cards, picked, rerollUsedOn }
    history: [],
    stats: { done: 0 },
  };
}

function loadState(dir, steamId) {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(dir, steamId), 'utf8'));
    if (!raw || raw.version !== VERSION) return emptyState(steamId);
    // 필드가 빠진 옛 파일이어도 터지지 않게
    return {
      ...emptyState(steamId),
      ...raw,
      stats: { ...emptyState(steamId).stats, ...(raw.stats || {}) },
    };
  } catch (_e) {
    return emptyState(steamId);
  }
}

/**
 * 임시파일에 쓰고 rename — 쓰는 도중 죽어도 기존 파일이 깨지지 않는다.
 * (rename 은 같은 볼륨 안에서 원자적이다)
 */
function saveState(dir, steamId, state) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const target = stateFile(dir, steamId);
    const tmp = `${target}.${process.pid}.tmp`;
    const trimmed = { ...state, history: (state.history || []).slice(0, HISTORY_LIMIT) };
    fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2));
    fs.renameSync(tmp, target);
    return true;
  } catch (_e) {
    return false;
  }
}

module.exports = { loadState, saveState, emptyState, stateFile, VERSION, HISTORY_LIMIT };
