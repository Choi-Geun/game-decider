// 다국어 사전 (한국어/English)
const I18N = {
  ko: {
    appTitle: '지금 뭐 켜지',
    loginDesc: 'Steam 라이브러리에서 오늘 켤 게임을 골라줄게요.',
    loginBtn: 'Steam으로 로그인',
    loginChecking: '로그인 창 확인 중…',
    sync: '🔄 동기화',
    syncing: '⏳ 동기화 중…',
    navSpin: '랜덤 스핀',
    navGames: '내 게임',
    navAch: '도전과제',
    navFriends: '친구랑',
    logout: '로그아웃',
    spinTitle: '오늘 뭐 켜지?',
    spinSub: '버튼을 눌러 라이브러리를 돌려보세요.',
    reroll: '돌려!',
    play: '실행',
    searchGames: '게임 검색…',
    tabStatus: '상태별',
    tabRarity: '희귀도별',
    tabGame: '게임별',
    findCoop: '친구랑 할 코옵 게임 찾기',
    openSteamSettings: '🔧 Steam 개인정보 설정 열기',
    achBlocked: '도전과제가 비공개예요. Steam → 프로필 편집 → 개인정보에서 "게임 세부 정보"를 공개로 바꾸고 다시 동기화하세요.',
    // 동기화 상태
    syncedAt: '동기화됨: {date} · 게임 {n}개',
    notSynced: '아직 동기화 안 됨 → 🔄',
    syncChecking: '변경사항 확인 중…',
    syncFull: '전체 동기화 시작…',
    syncProgress: '동기화 중… {done}/{total} — {name}',
    syncUpdated: '✅ {n}개 갱신',
    syncLatest: '✅ 최신 상태',
    syncNewGames: '새 게임 {n}',
    syncFail: '❌ 동기화 실패',
    // 스핀 이유
    reasonNever: '아직 한 번도 안 해봤어요. 첫 판 각! 🎬',
    reasonFinish: '도전과제 {pct}% 달성 — 마무리 각! 🏁',
    reasonRecent: '요즘 하던 거예요. 이어서 고고! ▶',
    reasonFav: '플레이 {hours}시간, 최애잖아요. 또 켜자 ❤️',
    reasonBacklog: '산 지 오래됐는데 {hours}시간뿐. 이제 할 때 📦',
    reasonDefault: '오늘의 선택! 운명이라 생각하고 켜보자 ✨',
    spinNeedGames: '동기화된 게임이 없어요. 먼저 🔄 동기화하세요.',
    // 도전과제 상태 그룹
    stContinue: '이어하기',
    stContinueSub: '최근 하던 게임, 이어서',
    stFinish: '마무리각',
    stFinishSub: '거의 다 깬 게임 (50~99%)',
    stEasy: '쉬운거',
    stEasySub: '금방 딸 수 있는 도전과제가 남음',
    stRare: '희귀사냥',
    stRareSub: '희귀 도전과제가 남은 게임',
    // 희귀도
    tierDiamond: '다이아 (≤5%)',
    tierGold: '골드 (5~20%)',
    tierSilver: '실버 (20~50%)',
    tierBronze: '브론즈 (>50%)',
    rarityLockedNote: '아직 못 딴 도전과제를 희귀도로 분류했어요.',
    // 공통
    completion: '달성 {pct}%',
    achCount: '{u}/{t} 달성',
    locked: '미달성',
    ownedBy: '보유 친구 {n}명',
    onlineN: '온라인 {n}',
    playingNow: '▶ 지금 이 게임!',
    coop: '코옵',
    multi: '멀티',
    friendChecking: '친구 라이브러리 확인 중… (처음엔 조금 걸려요)',
    friendSummary: '친구 {n}명 중 공개 {p}명 · 함께 할 게임 {g}개',
    friendPrivate: '친구 목록이 비공개이거나 친구가 없어요. (Steam 개인정보 → "친구 목록" 공개 확인)',
    friendNoCoop: '친구 {n}명 확인 — 함께 할 코옵/멀티 게임이 없어요.',
    friendFail: '❌ 친구 정보를 불러오지 못했어요',
    noAchGames: '도전과제 데이터가 있는 게임이 없어요.',
    emptyGroup: '해당하는 게임이 없어요.',
    syncFirst: '먼저 🔄 동기화하세요.',
    hours: '시간',
  },
  en: {
    appTitle: 'What to Play',
    loginDesc: "We'll pick tonight's game from your Steam library.",
    loginBtn: 'Sign in with Steam',
    loginChecking: 'Waiting for login…',
    sync: '🔄 Sync',
    syncing: '⏳ Syncing…',
    navSpin: 'Spin',
    navGames: 'My Games',
    navAch: 'Achievements',
    navFriends: 'With Friends',
    logout: 'Log out',
    spinTitle: 'What to play today?',
    spinSub: 'Hit the button to spin your library.',
    reroll: 'SPIN!',
    play: 'Play',
    searchGames: 'Search games…',
    tabStatus: 'By status',
    tabRarity: 'By rarity',
    tabGame: 'By game',
    findCoop: 'Find co-op games with friends',
    openSteamSettings: '🔧 Open Steam privacy settings',
    achBlocked: 'Achievements are private. In Steam → Edit Profile → Privacy, set "Game details" to Public, then sync again.',
    syncedAt: 'Synced {date} · {n} games',
    notSynced: 'Not synced yet → 🔄',
    syncChecking: 'Checking for changes…',
    syncFull: 'Starting full sync…',
    syncProgress: 'Syncing… {done}/{total} — {name}',
    syncUpdated: '✅ {n} updated',
    syncLatest: '✅ Up to date',
    syncNewGames: '{n} new',
    syncFail: '❌ Sync failed',
    reasonNever: "Never played this yet. Perfect for a first run! 🎬",
    reasonFinish: '{pct}% achievements done — go finish it! 🏁',
    reasonRecent: "You've been on this lately — keep going! ▶",
    reasonFav: '{hours}h played — a favorite. Fire it up ❤️',
    reasonBacklog: 'Owned a while, only {hours}h in — time to dive 📦',
    reasonDefault: "Today's pick! Call it fate and dive in ✨",
    spinNeedGames: 'No synced games. Hit 🔄 sync first.',
    stContinue: 'Continue',
    stContinueSub: 'Games you played recently',
    stFinish: 'Finish it',
    stFinishSub: 'Almost done (50–99%)',
    stEasy: 'Easy wins',
    stEasySub: 'Easy achievements still left',
    stRare: 'Rare hunt',
    stRareSub: 'Games with rare achievements left',
    tierDiamond: 'Diamond (≤5%)',
    tierGold: 'Gold (5–20%)',
    tierSilver: 'Silver (20–50%)',
    tierBronze: 'Bronze (>50%)',
    rarityLockedNote: 'Your locked achievements grouped by rarity.',
    completion: '{pct}% done',
    achCount: '{u}/{t} unlocked',
    locked: 'Locked',
    ownedBy: '{n} friends own it',
    onlineN: '{n} online',
    playingNow: '▶ Playing now!',
    coop: 'Co-op',
    multi: 'MP',
    friendChecking: 'Checking friends’ libraries… (first time takes a bit)',
    friendSummary: '{p}/{n} friends public · {g} shared games',
    friendPrivate: 'Friend list is private or empty. (Steam Privacy → set "Friends list" public)',
    friendNoCoop: '{n} friends checked — no shared co-op/MP games.',
    friendFail: '❌ Could not load friends',
    noAchGames: 'No games with achievement data.',
    emptyGroup: 'Nothing here.',
    syncFirst: 'Hit 🔄 sync first.',
    hours: 'h',
  },
};

let LANG = localStorage.getItem('lang') || (navigator.language && navigator.language.startsWith('ko') ? 'ko' : 'en');

function t(key, vars) {
  let s = (I18N[LANG] && I18N[LANG][key]) != null ? I18N[LANG][key] : (I18N.ko[key] != null ? I18N.ko[key] : key);
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

function applyI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('.lang-switch button').forEach((b) => b.classList.toggle('active', b.dataset.lang === LANG));
}

function setLang(l) {
  LANG = l;
  localStorage.setItem('lang', l);
  applyI18n();
  if (window.onLangChange) window.onLangChange();
}

// 게임 상태별 이유 문구 풀 — {h}시간 {w}분 {pct}% {u}/{t} {rare}% {left}개
const REASONS = {
  ko: {
    never: ['한 번도 안 켜봤네요. 오늘이 데뷔전! 🎬', '설치만 하고 방치 중… 첫 판 갑시다 🎬', '미개봉 신상. 지금 뜯을 때예요 📦', '플레이타임 0시간, 완전 백지! 첫인상 남기러 가죠 ✨'],
    backlog: ['산 지 오래인데 겨우 {h}시간. 이제 진짜 할 때 📦', '{h}시간밖에 안 했어요. 방치는 이제 그만 🧹', '위시리스트의 한을 풀 시간, {h}시간짜리 각 🎯'],
    recent: ['최근에 {w}분이나 잡았잖아요. 이어서 고고 ▶', '요즘 손이 가는 게임, 흐름 끊지 말고 계속 🔥', '이거 한창 재밌을 때죠? {w}분의 여운 이어가기 ▶'],
    almost: ['도전과제 {pct}%! 조금만 더 하면 100% 🏁', '{t}개 중 {u}개 달성 — 완주 코앞이에요 🏁', '{pct}% 왔는데 여기서 멈추긴 아깝죠 🏆'],
    halfway: ['도전과제 {pct}% 진행 중, 딱 반환점 💪', '{u}/{t} 달성 — 아직 파볼 게 많아요 ⛏️', '절반쯤 왔어요. 오늘 좀 더 밀어붙일까요? 💪'],
    completed: ['이미 100% 마스터한 인생겜, 그래도 또? 👑', '도전과제 올클리어! 순수 재미로 다시 🎮', '{t}개 다 깬 완전정복작. 회귀 플레이 각 👑'],
    rare: ['희귀 도전과제 {rare}%짜리가 남아있어요. 자랑각 💎', '전역 {rare}% 그 도전과제, 오늘 따버릴까요? 💎', '레어 트로피 사냥 시간 — {rare}% 도전 🏹'],
    easy: ['쉬운 도전과제 {left}개 남음, 금방 딸 수 있어요 ⚡', '거저 주는 도전과제 {left}개가 기다려요 ⚡', '{left}개만 더 따면 기분 좋아지는 게임 😎'],
    favorite: ['{h}시간 플레이한 최애, 안 켤 이유가? ❤️', '이미 {h}시간… 그럼에도 또 당기죠 ❤️', '인생겜 {h}시간의 주인공, 오늘도 함께 🎮'],
    default: ['오늘의 운명픽 ✨', '고민 끝, 그냥 이거 켜요 🎯', '슬롯이 골랐으니 믿고 가보죠 🎰', '왠지 오늘은 이거예요 🍀'],
  },
  en: {
    never: ["Never launched this — today's the debut! 🎬", 'Installed and forgotten… first run time 🎬', 'Still shrink-wrapped. Time to unbox 📦', '0 hours played — a blank slate. Go make a first impression ✨'],
    backlog: ['Owned forever, only {h}h in. Time to dive 📦', "Just {h}h so far — end the backlog 🧹", 'Redeem that wishlist buy — {h}h and counting 🎯'],
    recent: ["You put {w}min into it lately — keep going ▶", "You're on a roll, don't break the flow 🔥", 'Still in the good part? Ride the momentum ▶'],
    almost: ['{pct}% achievements — so close to 100%! 🏁', '{u} of {t} done — the finish line is right there 🏁', "{pct}% in, too good to stop now 🏆"],
    halfway: ['{pct}% through achievements — halfway there 💪', '{u}/{t} unlocked — plenty left to dig 🛠️', 'About halfway. Push a little further today? 💪'],
    completed: ['Already 100% mastered — round two? 👑', 'All achievements done! Replay for pure fun 🎮', 'Fully conquered all {t}. Time for a comeback 👑'],
    rare: ['A {rare}% rare achievement is still yours to grab 💎', 'That {rare}%-global trophy — snag it today? 💎', 'Rare trophy hunt — go for the {rare}% one 🏹'],
    easy: ['{left} easy achievements left — quick wins ⚡', '{left} freebie achievements are waiting ⚡', 'Just {left} more for that feel-good ding 😎'],
    favorite: ["{h}h played — a favorite. Why not? ❤️", 'Already {h}h and still calling you ❤️', 'Star of your {h}h library, once more 🎮'],
    default: ["Today's fate pick ✨", 'Stop overthinking — just play this 🎯', 'The slot chose it, so trust it 🎰', 'Feels like a this-one kind of day 🍀'],
  },
};

