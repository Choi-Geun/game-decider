// 아주 작은 .env 로더 (외부 패키지 없이). "KEY=value" 줄들을 읽어 객체로 돌려준다.
const fs = require('fs');

function loadEnv(filePath) {
  const out = {};
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      // 양쪽 따옴표 제거
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
  } catch (_e) {
    // .env 없으면 그냥 빈 객체 → 로컬 추천 로직으로 동작
  }
  return out;
}

module.exports = { loadEnv };
