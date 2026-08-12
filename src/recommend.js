// 조건(기분/시간/인원)을 받아 게임 1개를 고른다.
// - ANTHROPIC_API_KEY 가 .env 에 있으면 Claude 에게 물어본다.
// - 없으면 로컬 점수 로직으로 고른다 (돈 안 쓰고도 동작).

const https = require('https');

// ── 로컬 폴백: 태그/장르 기반 간단 점수 매기기 ──────────────────────
function localPick(games, input) {
  const { mood, time, players, backlogOnly } = input;

  let pool = games;

  // 백로그 모드: 플레이타임이 적거나 모르는(=거의 안 한) 것 우선
  if (backlogOnly) {
    pool = pool.filter((g) => g.playtimeMinutes == null || g.playtimeMinutes < 120);
    if (pool.length === 0) pool = games;
  }

  // 인원 필터: 친구랑 → 멀티/코옵 태그 있는 것
  if (players === 'coop') {
    const multi = pool.filter((g) =>
      [...(g.tags || []), ...(g.genres || [])]
        .map((t) => String(t).toLowerCase())
        .some((t) => t.includes('multi') || t.includes('co-op') || t.includes('coop') || t.includes('멀티') || t.includes('코옵'))
    );
    if (multi.length) pool = multi;
  }

  // 기분/시간에 맞춰 점수 (아주 단순한 키워드 매칭)
  const moodKeywords = {
    intense: ['action', 'shooter', 'fps', 'roguelike', 'souls', '액션', '슈팅'],
    relaxed: ['casual', 'simulation', 'cozy', 'farming', 'puzzle', '힐링', '캐주얼'],
    immersive: ['rpg', 'story', 'open world', 'adventure', 'narrative', '오픈월드', '스토리'],
    light: ['arcade', 'party', 'indie', 'platformer', '아케이드', '파티'],
  };
  const wanted = moodKeywords[mood] || [];

  const scored = pool.map((g) => {
    const hay = [...(g.tags || []), ...(g.genres || []), g.name]
      .join(' ')
      .toLowerCase();
    let score = 0;
    for (const k of wanted) if (hay.includes(k)) score += 2;
    // 짧은 시간대인데 장시간 RPG면 살짝 감점
    if (time === 'short' && hay.includes('rpg')) score -= 1;
    // 약간의 변주(고정 순서 방지)를 위해 이름 길이 기반 소소한 tie-breaker
    score += (g.name.length % 3) * 0.1;
    return { g, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.max(1, Math.min(5, scored.length)));
  // 상위 후보 중 하나를 시간 기반으로 회전 선택(“다시 굴리기”가 다양해지도록)
  const pick = top[(input._roll || 0) % top.length].g;

  return {
    source: 'local',
    game: pick,
    reason: buildLocalReason(pick, input),
  };
}

function buildLocalReason(game, input) {
  const moodLabel = { intense: '빡센', relaxed: '느긋한', immersive: '몰입되는', light: '가벼운' }[input.mood] || '';
  const timeLabel = { short: '30분 정도', medium: '1~2시간', long: '길게' }[input.time] || '';
  const playersLabel = input.players === 'coop' ? '친구랑 하기 좋고' : '혼자 즐기기 좋고';
  return `지금 ${moodLabel} 기분에 ${timeLabel} 하기 딱이라 골랐어요. ${playersLabel}, 라이브러리에서 지금 상황과 결이 맞는 선택입니다.`;
}

// ── Claude API 호출 (키가 있을 때) ───────────────────────────────
function callClaude(apiKey, prompt) {
  const body = JSON.stringify({
    model: 'claude-3-5-haiku-latest',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });
  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-length': Buffer.byteLength(body),
    },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json.content?.[0]?.text || '';
          resolve(text);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function aiPick(games, input, apiKey) {
  const list = games
    .map((g) => `- ${g.name} (appid:${g.appid}${g.playtimeMinutes != null ? `, 플레이 ${g.playtimeMinutes}분` : ''})`)
    .join('\n');
  const moodLabel = { intense: '빡센', relaxed: '느긋', immersive: '몰입', light: '가벼움' }[input.mood] || input.mood;
  const timeLabel = { short: '30분', medium: '1~2시간', long: '오래' }[input.time] || input.time;
  const playersLabel = input.players === 'coop' ? '친구랑' : '혼자';

  const prompt = `너는 게임 큐레이터야. 아래는 사용자가 Steam에 설치해둔 게임 목록이야.
지금 사용자의 상태: 기분=${moodLabel}, 가용시간=${timeLabel}, 인원=${playersLabel}${input.backlogOnly ? ', 조건=사둔 지 오래됐거나 거의 안 한 게임 우선' : ''}.

목록에서 지금 상황에 가장 잘 맞는 게임 딱 1개만 골라줘.
반드시 아래 JSON 형식으로만 답해. 다른 말 금지:
{"appid":"<고른 게임 appid>","name":"<게임 이름>","reason":"<왜 이걸 골랐는지 한국어 2문장>"}

게임 목록:
${list}`;

  const text = await callClaude(apiKey, prompt);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 응답 파싱 실패');
  const parsed = JSON.parse(match[0]);
  const game = games.find((g) => g.appid === String(parsed.appid)) || games.find((g) => g.name === parsed.name);
  if (!game) throw new Error('AI가 고른 게임을 목록에서 못 찾음');
  return { source: 'ai', game, reason: parsed.reason };
}

async function recommend(games, input, env) {
  if (!games || games.length === 0) {
    return { source: 'empty', game: null, reason: '설치된 게임을 찾지 못했어요.' };
  }
  const apiKey = env && env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      return await aiPick(games, input, apiKey);
    } catch (e) {
      // AI 실패하면 조용히 로컬로 폴백
      return localPick(games, input);
    }
  }
  return localPick(games, input);
}

module.exports = { recommend, localPick };
