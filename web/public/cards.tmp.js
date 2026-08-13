const fs = require('fs');
let s = fs.readFileSync('styles.css', 'utf8');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
const EOL = s.indexOf(CR + LF) >= 0 ? CR + LF : LF;
const N = (x) => x.split(LF).join(EOL);
const rep = (a, b) => { a = N(a); b = N(b); if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 55)); s = s.split(a).join(b); };

// 지표 타일 — 캔버스: panel-2 배경 + 등급색 테두리 전체 + r-lg + 왼쪽 여백 강조
rep(`.d-stat {
  display: flex; flex-direction: column; gap: 1px; padding: 14px 16px;
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-lg); border-top-width: 3px;
}
.d-stat.t-good { border-top-color: var(--accent); }
.d-stat.t-mid  { border-top-color: var(--gold); }
.d-stat.t-bad  { border-top-color: var(--danger); }`,
`.d-stat {
  display: flex; flex-direction: column; gap: 1px; padding: 18px 4px 18px 22px;
  background: var(--panel-2); border: 1px solid var(--border); border-radius: var(--r-lg);
}
.d-stat.t-good { border-color: var(--accent); }
.d-stat.t-mid  { border-color: var(--gold); }
.d-stat.t-bad  { border-color: var(--danger); }`);

// 오늘의 도전 카드 — 캔버스 r=20 (r-xl). 나머지 카드(14)보다 크게 둔 건 의도다.
rep(`.draw-card {
  position: relative; display: flex; flex-direction: column; width: 330px; height: 430px; flex: none;
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-lg); overflow: hidden;`,
`.draw-card {
  position: relative; display: flex; flex-direction: column; width: 330px; height: 430px; flex: none;
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-xl); overflow: hidden;`);

// 진행 바 — 캔버스는 전용 track 색에 r-xs
rep(`.rc-bar { height: 8px; border-radius: 4px; background: var(--panel2); overflow: hidden; }`,
`.rc-bar { height: 8px; border-radius: var(--r-xs); background: var(--track); overflow: hidden; }`);

fs.writeFileSync('styles.css', s);
console.log('카드·지표·진행바 정리 완료');
JSON.stringify(0);
