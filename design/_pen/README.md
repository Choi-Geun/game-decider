# Pencil(.pen) 디자인 관리 규칙 — 게임 디사이더

이 폴더는 **pen.dev(Pencil) 디자인 작업물**을 관리하는 영역입니다.
볼트의 공통 규칙(`Root's AI Brain/01 Projects/게이트웨이/04 화면설계/_pen/README.md`)을 이 리포에 맞춰 적용했습니다.

## 폴더 구조

```
design/_pen/
├── src/                    # .pen 소스 (Pencil MCP 전용) — git 커밋 대상
│   ├── game-decider.pen
│   └── images/             # 임포트한 이미지 — .pen 이 상대경로로 참조하므로 함께 커밋
├── exports/                # 파생물 — gitignore (재생성 가능)
│   ├── png/                # PNG (리뷰·문서 첨부)
│   └── html/               # HTML export (개발 전달용)
└── README.md
```

## ⚠️ Pencil MCP 는 `filePath` 인자를 무시한다

도구마다 `filePath` 를 받지만 실제로는 **Pen 앱에서 열려 있는 편집기**에 쓴다.
다른 경로를 지정해도 무시되므로:

1. 작업 전 `get_app_state` 로 *Currently active canvas editor* 가
   `design/_pen/src/game-decider.pen` 인지 확인한다.
2. 아니면 Pen 앱에서 **그 파일을 먼저 연다.**

실제 사고 사례(2026-08-13): 옮겨진 옛 경로(`game-decider/ui`)의 편집기가 열려 있어
작업이 전부 그쪽으로 들어갔고, **리포 루트에 `images/` 폴더가 생겼다**
(임포트 이미지가 `ui` 기준 상대경로로 저장됨). 나중에 수동으로 이동해야 했다.

> 임포트한 이미지는 `.pen` 과 **같은 폴더 기준 상대경로**로 참조된다.
> `.pen` 을 옮기면 `images/` 도 반드시 같이 옮길 것.

## 규칙

1. **`.pen` 은 `src/` 에만** 둔다. **Pencil MCP 도구로만** 접근하고, Read/Grep으로 열지 않는다.
2. **파일 단위 = 모듈/기능별 1파일.** 한 파일 안에서 화면을 프레임(Frame)으로 나눈다.
3. `exports/` 는 언제든 재생성 가능한 **파생물**이다. 원본은 항상 `src/*.pen`.
4. git: `src/*.pen` 은 커밋, `exports/` 는 무시 (`.gitignore` 참조).

## 명명 규칙

| 대상 | 규칙 | 예시 |
|------|------|------|
| .pen 파일 | `<기능/모듈>.pen` | `game-decider.pen` |
| PNG export | `<pen파일명>-<프레임>.png` | `game-decider-스핀화면.png` |
| HTML export | `<pen파일명>-<프레임>.html` | `game-decider-스핀화면.html` |

## 작업 흐름

1. `get_app_state({include_schema:true, include_canvas_design:true, include_scripts_and_shaders:false})` 로 스키마 파악 (**모든 작업의 전제**)
2. `execute` 로 프레임·레이어 생성/수정
3. `get_screenshot` 으로 검토
4. 필요 시 `export_nodes`(PNG) / `export_html`(HTML) 로 `exports/` 에 내보내기

## ⚠️ 전제 조건

**Pen 데스크톱 앱이 실행 중이어야** MCP가 붙는다 (`\\.\pipe\pencil-desktop`).
앱이 꺼진 상태로 세션을 시작하면 `pencil` MCP 서버가 드롭되어 도구가 안 잡힌다.
→ **Pen 앱을 먼저 켜고 → Claudian 세션 시작.**

## 현재 대상 화면 (v0.3 웹 기준)

| 화면 | 경로 | 비고 |
|------|------|------|
| 랜덤 스핀 | `/` (기본) | 코버플로우 슬롯 + 추천 이유 + 실행 |
| 내 게임 | LNB | 그리드 + 검색 + 달성률 바 |
| 도전과제 | LNB | 상태별/희귀도별/게임별 3탭 |
| 친구랑 | LNB | 코옵 게임 + 보유 친구 + 온라인 표시 |
| 게임 상세 | `/api/game/:appid` | 정보·진척도·평가·도전과제·뉴스·DLC |
