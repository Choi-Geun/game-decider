// 뉴스 언어 정리.
//
// Steam 의 GetNewsForApp 은 언어 필터가 없다. 공식 공지에 러시아·중국 게임
// 매체 피드가 섞여 나와서, 한국어로 쓰는 화면에 러시아어 기사가 그대로 올라왔다.
// (ELDEN RING 은 5건 중 4건이 Gamemag.ru 였다)
//
// 정책: 화면 언어와 같은 것 먼저, 없으면 영어. 그 외 문자권은 버린다.
// 영어를 폴백으로 두는 이유는 Steam 공식 공지 대부분이 영어이기 때문이다 —
// 여기까지 버리면 뉴스 칸이 거의 항상 비게 된다.

const SCRIPTS = [
  { lang: 'ko', re: /[가-힯ᄀ-ᇿ]/ },           // 한글
  { lang: 'ru', re: /[Ѐ-ӿ]/ },                         // 키릴
  { lang: 'ja', re: /[぀-ゟ゠-ヿ]/ },            // 가나
  { lang: 'zh', re: /[一-鿿]/ },                         // 한자 (가나 검사 뒤에)
  { lang: 'th', re: /[฀-๿]/ },
  { lang: 'el', re: /[Ͱ-Ͽ]/ },
];

/**
 * 제목을 보고 문자권을 판별한다. 어느 것도 아니면 'en'(라틴)으로 본다.
 * 완벽한 언어 감지가 아니라 "다른 문자권을 걸러내는" 용도다 —
 * 라틴 문자권(영어·독일어·스페인어…)은 구분하지 않는다.
 */
function detectScript(text) {
  const s = String(text || '');
  for (const { lang, re } of SCRIPTS) if (re.test(s)) return lang;
  return 'en';
}

/**
 * @param {Array} items  뉴스 항목 [{ title, ... }]
 * @param {string} uiLang 화면 언어 ('korean' | 'english' | 'ko' | 'en')
 * @param {number} limit
 */
function filterNewsByLang(items, uiLang, limit = 4) {
  const want = /^ko/i.test(uiLang) || /korean/i.test(uiLang) ? 'ko' : 'en';
  const mine = [];
  const english = [];
  for (const n of items || []) {
    const script = detectScript(n.title);
    if (script === want) mine.push(n);
    else if (script === 'en') english.push(n);
    // 그 외 문자권은 버린다
  }
  return [...mine, ...english].slice(0, limit);
}

module.exports = { detectScript, filterNewsByLang };
