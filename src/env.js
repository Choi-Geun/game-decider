// 아주 작은 .env 로더 (외부 패키지 없이). "KEY=value" 줄들을 읽어 객체로 돌려준다.
//
// 배포 환경(Render 등)에는 .env 파일이 없고 값이 process.env 로만 들어온다.
// 그래서 process.env 를 밑에 깔고 .env 파일을 그 위에 얹는다 —
// 로컬에선 .env 가 이기고, 서버에선 파일이 없으니 process.env 가 그대로 쓰인다.
// (이걸 안 해서 배포하면 STEAM_API_KEY·PORT 가 통째로 undefined 가 된다.)
const fs = require('fs');

function loadEnv(filePath) {
  const out = Object.assign({}, process.env);
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
