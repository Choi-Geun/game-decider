// Pen 토큰 스냅샷 ↔ styles.css :root 대조.
//
//   node design/_pen/check-tokens.js
//
// Pencil MCP 는 Claudian 세션에서만 닿으므로 .pen 을 직접 읽지는 못한다.
// 대신 tokens.json(= Pen 변수 사본)과 CSS 를 비교해 어긋난 값을 잡아낸다.
// tokens.json 자체는 "Pen 토큰 동기화" 절차로 갱신한다 (README 참고).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, 'tokens.json'), 'utf8'));
const css = fs.readFileSync(path.join(ROOT, 'web', 'public', 'styles.css'), 'utf8');

const rootBlock = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
const cssVars = {};
for (const m of rootBlock.matchAll(/--([\w-]+):\s*([^;]+);/g)) cssVars[m[1]] = m[2].trim();

// 숫자 토큰은 CSS 에서 px 이 붙는다
const norm = (k, v) => {
  let s = String(v).trim().toLowerCase();
  if (/^\$/.test(s)) s = 'var(--' + s.slice(1) + ')';
  if (/^(r-|fs-)/.test(k) && /^\d+$/.test(s)) s = s + 'px';
  return s;
};

const skip = new Set(['_', '_syncedAt', 'font-ui', 'font-mono', 'fw-regular', 'fw-semibold', 'fw-bold', 'fw-black', 'fs-2xs', 'white']);
const missing = [], mismatch = [];
for (const [k, v] of Object.entries(tokens)) {
  if (skip.has(k)) continue;
  const want = norm(k, v);
  const got = cssVars[k] ? cssVars[k].trim().toLowerCase() : null;
  if (got == null) { missing.push(k); continue; }
  if (got !== want) mismatch.push({ k, pen: want, css: got });
}

if (!missing.length && !mismatch.length) {
  console.log('✅ Pen 토큰과 CSS 가 일치합니다 (' + (Object.keys(tokens).length - skip.size) + '개 대조).');
  process.exit(0);
}
if (missing.length) console.log('CSS 에 없는 토큰: ' + missing.join(', '));
for (const m of mismatch) console.log('불일치  --' + m.k + '  pen=' + m.pen + '  css=' + m.css);
process.exit(1);
