# 🎮 게임 디사이더 — "지금 뭐 켜지"

내 Steam 라이브러리에서 지금 기분·시간·인원에 맞는 게임 1개를 골라주고 바로 실행까지 해주는 데스크톱 앱.

## 실행 방법

```bash
cd ~/game-decider
npm start
```

창이 뜨면 기분/시간/인원을 고르고 **🎲 골라줘** 를 누르면 됩니다.

## 지금 상태 (개발 단계)

- **맥(개발용)**: `mock/games.json` 의 가짜 게임 목록으로 동작 → UI·추천 로직 확인용
- **윈도우(실사용)**: 실제 설치된 Steam 게임을 자동으로 읽어옴 (`src/steam.js`)
- **AI 추천**: `.env` 에 `ANTHROPIC_API_KEY` 를 넣으면 Claude가 골라줌.
  없으면 로컬 점수 로직으로 동작(무료).

## AI 켜기 (선택)

```bash
cp .env.example .env
# .env 파일을 열어 ANTHROPIC_API_KEY= 뒤에 키를 붙여넣기
```

## 윈도우 게이밍 PC에서 실사용하기

1. 이 폴더를 윈도우 PC로 옮김 (git clone 또는 복사)
2. Node.js 설치 후 `npm install`
   - 회사 네트워크면 TLS 오류가 날 수 있음 → 아래 참고
3. `npm start` → 실제 내 게임으로 동작

### 회사 네트워크(SSL 검사) 대응
`self-signed certificate` 오류가 나면 설치 시:
```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 npm install --strict-ssl=false
```
(회사 프록시가 SSL을 가로채서 생기는 문제. 개발용 우회임.)

## 폴더 구조

```
game-decider/
├─ main.js          Electron 메인(창 생성 + 요청 처리)
├─ preload.js       화면에 안전한 API 노출
├─ index.html       화면 UI
├─ renderer.js      화면 로직
├─ src/
│  ├─ steam.js      설치 게임 읽기(윈도우 실데이터 / 맥 mock)
│  ├─ recommend.js  추천 로직(AI 또는 로컬)
│  └─ env.js        .env 로더
└─ mock/games.json  개발용 가짜 게임 목록
```
