// 게임 상세 정보 수집 (앱 단위, TTL 캐싱).
// 정보/DLC/뉴스/평가 — Steam 여러 API 조합. 유저별 진척도는 server에서 합침.
const fs = require('fs');
const path = require('path');
const api = require('./steamApi');
const { filterNewsByLang } = require('./newsLang');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TTL = 6 * 60 * 60 * 1000; // 6시간

function detailFile(dir, appid) {
  return path.join(dir, 'details', `${appid}.json`);
}
function loadDetail(dir, appid) {
  try { return JSON.parse(fs.readFileSync(detailFile(dir, appid), 'utf8')); } catch (_e) { return null; }
}
function saveDetail(dir, appid, data) {
  try {
    fs.mkdirSync(path.join(dir, 'details'), { recursive: true });
    fs.writeFileSync(detailFile(dir, appid), JSON.stringify(data, null, 2));
  } catch (_e) {}
}

// 앱 정보에서 화면에 쓸 것만 추림
function trimInfo(d) {
  if (!d) return null;
  return {
    name: d.name,
    shortDescription: d.short_description,
    headerImage: d.header_image,
    developers: d.developers || [],
    publishers: d.publishers || [],
    genres: (d.genres || []).map((g) => g.description),
    releaseDate: d.release_date ? d.release_date.date : null,
    metacritic: d.metacritic ? d.metacritic.score : null,
    price: d.is_free ? 'Free' : (d.price_overview ? d.price_overview.final_formatted : null),
    website: d.website || null,
    screenshots: (d.screenshots || []).slice(0, 4).map((s) => s.path_thumbnail),
  };
}

async function buildGameDetail(appid, lang, dir, nowMs) {
  const cached = loadDetail(dir, appid);
  if (cached && cached.lang === lang && nowMs - cached.at < TTL) return cached;

  const [details, rawNews, reviews] = await Promise.all([
    api.getAppDetails(appid, lang),
    // 다른 문자권을 걸러낼 걸 감안해 넉넉히 받는다. Steam 뉴스 API 에는
    // 언어 필터가 없어서 러시아·중국 매체 피드가 그대로 섞여 온다.
    api.getNewsForApp(appid, 20, 400),
    api.getAppReviews(appid),
  ]);
  const news = filterNewsByLang(rawNews, lang, 4);

  // DLC 이름 해석 (최대 8개)
  const dlcIds = (details && details.dlc) || [];
  const dlc = [];
  for (const id of dlcIds.slice(0, 8)) {
    const d = await api.getAppDetails(id, lang);
    if (d) dlc.push({ appid: String(id), name: d.name, header: api.imageUrls(id).header, price: d.is_free ? 'Free' : (d.price_overview ? d.price_overview.final_formatted : null) });
    await sleep(180);
  }

  const data = { appid: String(appid), lang, at: nowMs, info: trimInfo(details), news, reviews, dlc, dlcTotal: dlcIds.length };
  saveDetail(dir, appid, data);
  return data;
}

module.exports = { buildGameDetail };
