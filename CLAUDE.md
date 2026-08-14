# 오늘 뭐 깨지 (game-decider)

Steam 라이브러리에서 **안 깬 도전과제 하나를 골라 오늘의 목표로** 만들어주는 웹앱.
게임을 고르는 게 아니라 **도전과제를 고른다** — 이게 다른 추천 서비스와의 차이다.

> 전역 작업 원칙은 `~/.claude/CLAUDE.md` 참고. 특히 **UX 최우선**이 이 프로젝트의 기본값이다.

## 실행

```bash
cd web && npm start          # → http://localhost:3000
npm test                     # node:test, 의존성 없음
```

`.env` 에 `STEAM_API_KEY` 필요. `DEV_LOGIN_STEAMID` 를 넣으면
`/dev/login` · `/dev/logout` 으로 Steam 로그인 없이 상태를 바꿀 수 있다
(localhost 요청 + 환경변수 둘 다 있을 때만 동작, 아니면 404).

## 구조

```
src/            순수 로직 — 화면 없이 테스트된다
  gameState.js    상태 판정기(무한형/미개봉/찍먹/진행중/중도이탈/완주). 나머지가 여기 얹힌다
  resume.js       이어하기 카드 (마지막 깬 것 → 다음 지점)
  collection.js   트로피 등급·게임별 수집·거의 다 깬 게임
  draw.js         뽑기 루프(카드 3장·판정) / store.js  유저 상태 JSON
  genreBuckets.js 친구랑 성격 분류 (Steam 태그 기반)
  newsLang.js     뉴스 문자권 필터
web/public/     화면 (app.js / styles.css / i18n.js) — 빌드 없음, 순수 JS
design/_pen/    Pencil 디자인 원본 → 별도 README 의 규칙을 반드시 읽을 것
```

## 이 프로젝트에서 반복해서 물린 함정

### 데이터
- **`unlockTime` 이 핵심 자산이다.** Steam 은 세션 이력을 안 주지만 "언제 무엇을
  깼는지"는 준다. `lastPlayed` 는 런처만 켜도 갱신되므로 몰입도 판단엔 `lastUnlock` 을 쓴다.
- **절대 임계값으로 그룹을 끊지 말 것.** "3개 이하 남음", "85% 이상" 같은 기준은
  라이브러리에 따라 통째로 비어버린다(실측 0개). 항상 **상대 순위**로 뽑는다.
- **도전과제 3개 이하 게임은 제외**한다. CS2 는 도전과제가 1개라 `1/1 = 100% 완주`로
  잡히는 거짓 신호를 만든다.
- **Steam `genres` 로는 성격을 못 가른다** (Risk of Rain 2 = "Action, Indie"가 전부).
  로그라이크·오픈월드·생존은 **유저 태그**에만 있다. SteamSpy → 없으면 스토어 페이지.
- **CDN 이미지가 없는 게임이 있다**(미출시·베타). URL 은 appid 로 조립할 뿐 검증되지
  않으므로 폴백이 필수.
- 구매가·구매일은 **공개 API 에 없다.** 정가(appdetails)로만 말할 수 있다.

### 화면
- 애니메이션에 `animation-fill-mode: backwards` 쓰지 말 것. 탭이 백그라운드면
  from 상태(opacity 0)에 멈춰 **콘텐츠가 통째로 안 보인다.**
- 카드 높이는 **폭**에서 나와야 한다. 뷰가 100vh 를 채우고 덱이 flex:1 을 먹으면
  `align-items:stretch` 가 카드를 창 높이까지 늘린다.
- 색·모서리·글자크기는 `styles.css` 의 `:root` 토큰만 쓴다.
  **원본은 Pen 캔버스의 디자인 변수**이고 `:root` 는 그 사본이다.

### 도구
- `.pen` 은 암호화 바이너리다. `.gitattributes` 로 binary 고정 (안 하면 CRLF 변환에 깨짐).
- **Pencil MCP 는 `filePath` 인자를 무시하고** 열려 있는 편집기에 쓴다.
  작업 전 `get_app_state` 로 활성 파일을 확인할 것.
- `styles.css` 는 CRLF/LF 가 섞여 있다. 스크립트로 일괄 치환할 때 개행을 맞춰야 한다.
  **일괄 치환은 `:root` 정의부를 건드리지 않게 범위를 잘라라** — 한 번 `--gold: var(--gold)`
  같은 순환 참조를 만들어 색이 죽었는데 아무도 몰랐다.

### 캔버스 ↔ 코드 동기화 (매번 지킬 것)
`design/_pen/README.md` 의 "캔버스 ↔ 코드 동기화 규칙"이 정본. 요약하면:

- **토큰은 캔버스가 원천, 레이아웃은 코드가 원천.** 겹치는 영역을 만들지 않는다.
- **UI 를 코드에서 고쳤으면 캔버스도 갱신한다.** 이 단계를 빼먹으면 낡은 캔버스가
  다음 비교의 기준이 되어 "왜 다르지"가 반복된다. 반복 확인의 주범이었다.
- **대조는 전수로.** 눈에 띄는 것만 샘플링하면 매번 빠뜨린 게 나온다.
  색·모서리·타이포는 `node design/_pen/check-tokens.js` 로 기계가 비교한다.
- 임포트 전 **브라우저 폭 확인**. 폭이 다르면 다른 breakpoint 가 들어와 비교가 무의미하다.
  Pen 브라우저는 폭 지정이 안 되므로 **`?w=1920&h=1080`** 캡처 파라미터를 쓴다.
  캔버스의 '현재 구현' 프레임은 전부 1920 폭.
- **애니메이션이 걸린 요소는 임포터가 통째로 래스터화한다.** `.view` 의 `fade` 하나 때문에
  `main` 이 rectangle 한 장으로 들어왔다. 자식 0개면 이걸 의심할 것 —
  캡처 모드가 `animation: none !important` 로 막는다.
- `return-element` 는 **잎 노드에** 걸 것. 컨테이너에 걸면 50KB 를 넘겨 응답이 잘린다.

## 배포 (Render)

`render.yaml` 이 정본. Blueprint 로 연결하면 그대로 만들어진다.

- **서버는 `web/` 인데 공용 로직은 루트 `src/`** 다. rootDir 을 `web` 으로 잡으면
  `../src` 를 못 찾는다 → 루트에서 `cd web && node server.js`.
- **`loadEnv` 는 `process.env` 를 밑에 깔고 `.env` 파일을 위에 얹는다.**
  배포엔 `.env` 가 없으므로 환경변수가 그대로 쓰인다. 이걸 안 하면 배포 시
  `STEAM_API_KEY`·`PORT` 가 통째로 undefined 가 된다 (한 번 물릴 뻔했다).
- **`SESSION_SECRET` 없이는 배포 환경에서 서버가 안 뜬다.** 기본값
  `dev-secret-change-me` 로 공개 배포하면 누구나 남의 SteamID 로 서명된
  `gd_auth` 쿠키를 만들어 그 사람 행세를 할 수 있다. 그래서 죽게 해뒀다.
- **`/dev/*` 는 배포에서 무조건 404.** `trust proxy` 아래에선 `req.hostname` 이
  `X-Forwarded-Host` 를 따라가 위조 여지가 있어, 호스트 판정 전에 배포 여부로 먼저 끊는다.
- `BASE_URL` 은 Steam OpenID 의 realm/return_to 로 **그대로** 쓰인다. 접속 주소와
  한 글자라도 다르면 로그인이 실패한다. Render 는 `RENDER_EXTERNAL_URL` 을 자동 주입한다.
- **Free 플랜은 디스크가 휘발성**이다. 재배포·슬립 복귀마다 `.cache`/`.state` 가
  비고 유저는 다시 동기화해야 한다. 영구 보존은 Starter + disk + `DATA_DIR`.

## 열려 있는 것

- **콜드 스타트** — 로그인+동기화를 통과해야 첫 화면이 보인다. 유입의 병목.
  Free 플랜의 15분 슬립(첫 방문 ~50초)이 여기에 겹친다.
- **세션은 아직 메모리 저장소** — 로그인 자체는 `gd_auth` 쿠키로 스테이트리스라
  재시작에도 유지되지만, `express-session` 의 MemoryStore 는 방문자 수만큼 쌓인다.
  공개 트래픽이 붙으면 세션을 걷어내고 쿠키만 쓰는 쪽으로 정리할 것.
- **핵심 가정 미검증** — "유저가 도전과제를 목표로 삼고 싶어한다". 표본은 아직 1명.

기획 문서는 볼트의 `게임-디사이더/` 아래에 있다 (스펙 / 기능-구체화 / 재미-설계 / 뽑기-루프-설계).
