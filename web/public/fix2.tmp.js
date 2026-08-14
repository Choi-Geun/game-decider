const fs = require('fs');
let s = fs.readFileSync('styles.css', 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 60)); s = s.split(a).join(b); };

// ── 카드가 화면 높이를 따라 늘어나던 문제 ─────────────────────────
// 원인: 뷰가 100vh 를 채우도록 잡혀 있고(#view-daily), 덱이 그 남는 높이를
// flex:1 로 먹은 뒤, align-items:stretch 가 카드를 덱 높이까지 늘렸다.
// 즉 카드 높이가 '내용'이 아니라 '창 높이'로 정해지고 있었다.
//
// 카드 높이는 **폭**에서 나와야 한다 — 아트가 비율(554:360)이라 폭이 정해지면
// 높이도 정해진다. 그래서 세로 늘림을 전부 끊는다.
rep('.draw-deck { display: flex; gap: 28px; align-items: stretch; justify-content: center; flex: 1 1 auto; min-height: 0; }',
`/* align-items:stretch 는 유지 — 세 장의 키를 서로 맞추기 위한 것이지
   화면 높이에 맞추기 위한 게 아니다. 덱 자체가 안 늘어나면 '가장 큰 카드' 기준이 된다. */
.draw-deck { display: flex; gap: 28px; align-items: stretch; justify-content: center; }`);

rep('#view-daily { display: flex; flex-direction: column; min-height: calc(100vh - 56px); }\r\n#dailyContent { display: flex; flex-direction: column; flex: 1; min-height: 0; }',
`#view-daily { display: block; }
#dailyContent { display: block; }`);

rep('@media (max-width: 900px) { #view-daily { min-height: 0; } .draw-card { max-width: none; } }',
    '@media (max-width: 900px) { .draw-card { max-width: none; } }');

fs.writeFileSync('styles.css', s);
console.log('카드 높이 고정 완료');
