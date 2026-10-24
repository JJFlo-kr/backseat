<p align="center"><img src="resources/logo.svg" width="112" alt="Backseat logo"></p>

# Backseat (AI 소통기)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

화면을 캡처하고, 그 위에 그리면서 말하고, 그대로 AI 코딩 에이전트에게 보내는 Windows 도구.
"backseat driver"에서 이름을 땄다. AI가 운전(코딩)하고, 사용자는 뒷좌석에서 화면을 가리키며 지시한다.

*Backseat is a free Windows tray app: capture your screen, draw and talk over it, and send the result straight to an AI coding agent (Claude Code, Codex, Cursor and others). It also ships an MCP server so an agent can ask you to point at something. MIT-licensed; donations are voluntary.*

## 설치와 실행 (기본)

1. `dist\Backseat Setup <버전>.exe` 를 한 번 실행해 설치한다. 시작 메뉴와 바탕화면에 **Backseat** 가 생긴다.
2. Backseat 를 누르면 화면 오른쪽 아래 트레이에 아이콘이 뜬다. 창은 없다 — `Ctrl+Shift+A` 로 캡처한다.
3. 설치판은 **Windows에 로그인하면 자동으로 켜진다**. 끄려면 트레이 아이콘 우클릭 → "로그인 시 자동 시작" 체크 해제.
4. 새 버전 설치 파일을 실행하면 덮어써서 업데이트된다(설정과 세션은 그대로).

개발 폴더에서 직접 돌릴 때(코드를 고칠 때만):

```sh
npm install
npm run build
npm start          # 트레이 상주 (개발 실행은 로그인 자동 시작을 등록하지 않는다)
npm run dist       # 설치 파일 만들기 → dist\Backseat Setup <버전>.exe
```

## 쓰는 법

| 동작 | 키 |
|---|---|
| 영역 캡처 (화면이 멈추고 드래그로 선택) | `Ctrl+Shift+A` |
| 창 캡처 (마우스 아래 창을 클릭) | `Ctrl+Shift+W` — 선택 화면 안에서는 R/W/F/S로 전환 |
| 스크롤 캡처 (긴 페이지를 자동 스크롤해 이어붙임) | 선택 화면에서 `S` 후 창 클릭 — 진행 중 `Esc`로 중단 |
| 편집기 도구 | 펜 P · 텍스트 T · 화살표 A · 사각형 R · 번호 N · 블러 B · 자르기 C (되돌리기 가능) |
| 전/후 비교 (트레이 "마지막 영역 다시 캡처"로 찍었을 때) | O — 겹치기 / 와이프 / 차이, 브리프에 한 줄로 기록 |
| 색 고르기 | 툴바의 색 버튼 → 팔레트(선명·차분·파스텔·모노), 최근 색 6개, 직접 선택·hex, 스포이트(화면에서 색 집기) |
| 텍스트 꾸미기 (텍스트 도구일 때 셋째 줄) | 글자 효과(배경 상자·윤곽선·효과 없음) · 배경 상자 색/자동/불투명도 · ⇄ 반전 · 윤곽선 색 · 그림자 · 둘째 줄의 **B** *I* |
| 텍스트 입력 | Enter 완료 · Shift+Enter 줄바꿈 · Esc 취소 · 더블클릭으로 다시 편집 |
| 전송 대상 바꾸기 | 대상 바 클릭 또는 Ctrl+T → ↑↓ Enter. "이 창을 기본 대상으로 고정"을 켜면 다음부터 그 창이 우선(트레이에서 해제) |
| 녹음 시작/정지 | M (말하면서 그리면 발화가 주석에 자동으로 붙는다) |
| 타임라인 열기 / 재생 / 라이브 | L · Space · End |
| 되돌리기 / 다시 실행 | Ctrl+Z · Ctrl+Shift+Z |
| **전송** (작업하던 에이전트에게) | Enter |
| 저장 / 복사 / 녹화 내보내기 | Ctrl+S · Ctrl+C · Ctrl+E |

전송하면 `Pictures\Backseat\sessions\<id>\` 에 세션 패키지가 생기고(annotated.png, screenshot.png, brief.md, strokes.json,
transcript.json, audio.webm, meta.json), 캡처 직전에 쓰고 있던 창(터미널의 Claude Code, Claude 앱, ChatGPT/Codex 앱, Cursor,
VS Code, 브라우저 채팅, 그 밖의 앱 창)에 브리프 경로가 든 지시문 또는 이미지를 붙여넣는다. Enter는 사용자가 누른다.

AI가 화면 원래 내용과 사용자가 그린 것을 헷갈리지 않도록, annotated.png 의 Backseat 글자에는 왼쪽 위 보라색 "B" 표시가,
번호 원에는 보라색 테두리가 붙고, 주석 없는 원본은 screenshot.png 로 함께 저장된다(블러는 원본에도 적용). brief.md 맨 위에
이 사실이 한 줄로 적힌다.

## 에이전트 연결 (MCP)

Backseat 안에 stdio MCP 서버(`mcp-server.js`)가 들어 있다. **트레이 우클릭 → "에이전트 연결 설정(MCP) 복사"** 를 누르면
지금 설치된 위치를 가리키는 설정이 클립보드에 들어간다. Claude Code라면 프로젝트의 `.mcp.json` 에 그대로 붙여넣는다.
Node.js(`node`)가 있어야 한다.

- 설치판(기본 설치 위치):
  ```json
  { "mcpServers": { "backseat": { "command": "node", "args": ["C:/Users/<사용자>/AppData/Local/Programs/Backseat/resources/app.asar.unpacked/out/main/mcp-server.js"] } } }
  ```
  서버 파일은 MCP SDK·zod까지 묶은 상태로 `app.asar` 밖(`app.asar.unpacked`)에 풀려 있어서 일반 Node로 실행된다.
- 개발 폴더: `{ "command": "node", "args": ["D:/backseat/out/main/mcp-server.js"] }`

툴: `backseat_register`, `backseat_latest`(브리프 + 이미지), `backseat_list`, `backseat_get`, `backseat_wait`(다음 전송까지 대기),
`backseat_ask`(질문을 띄우고 사용자가 그려서 답할 때까지 대기). `integrations/claude-code/SKILL.md` 를 `.claude/skills/backseat/` 에 복사하면 `/backseat` 스킬이 된다.

## 음성 인식

transformers.js(ONNX)로 Whisper를 로컬에서 돌린다. 기본 모델 `onnx-community/whisper-small_timestamped`(한국어 단어 타임스탬프)는
첫 녹음 때 내려받아 `%APPDATA%\backseat\models` 에 캐시된다. 환경변수 `BACKSEAT_STT_MODEL` 로 바꿀 수 있다
(예: `onnx-community/whisper-large-v3-turbo_timestamped`, 더 정확하지만 큼).

클라우드로 돌리려면 `config.json`에 `"sttBackend": "openai"`(필요하면 `sttApiBase`, `sttCloudModel`)를 쓰고, API 키는 **환경변수
`BACKSEAT_STT_API_KEY`** 로만 준다(파일에 저장하지 않음). OpenAI 호환 `/v1/audio/transcriptions`(verbose_json, 단어 타임스탬프)를 쓰는
서버라면 어디든 된다.

## 검증

- `npm test` — 정렬·전사 그룹화·스크롤 스티칭·클라우드 STT 어댑터(모의 서버)·팔레트·전송 대상 판별 단위 테스트
- `npm run selftest` — 캡처, 창 열거, 선택창·편집기 렌더링, 타임라인 스크럽, undo/redo, 자르기(좌표·meta), 전/후 비교, 스크롤 캡처(자체 긴 페이지 창), 클라우드 STT(로컬 모의 서버), 텍스트 꾸미기(여러 줄·배경색·윤곽선·그림자·굵게/기울임), 색 팝오버·스포이트, 전송 대상 메뉴, 클립보드, 세션 패키지(screenshot.png 포함), 브리프 검증.
  `--selftest-wav=<wav>` 를 주면 STT와 음성 레인까지 확인한다.
- `node scripts/mcp-check.mjs <sessionsRoot>` — MCP 서버를 공식 클라이언트로 검증(ask 왕복 포함)

## 주의

- 프로젝트를 Claude 앱의 임시 폴더처럼 가상화된 AppData 아래에 두면 Electron 샌드박스와 Vite 빌드가 깨진다. D:\backseat 같은 일반 폴더에서 작업할 것.
- 설계와 진행 상황은 [PLAN.md](PLAN.md).

## 후원

Backseat은 **무료**이며 모든 기능을 제한 없이 쓸 수 있습니다. 후원 링크(Buy Me a Coffee)는 준비 중이며, 열리면 이 자리와 트레이 메뉴에 연결됩니다. 후원은 어디까지나 선택입니다(트레이 메뉴 "후원하기 ☕"와 "정보…" 창에서도 같은 링크로 연결됩니다). 링크는 [`src/shared/links.ts`](src/shared/links.ts)의 `SUPPORT_URL`과 이 README에 있습니다.

## 라이선스

[MIT](LICENSE) © 2026 wowls2162. 사용한 오픈소스의 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 정리되어 있습니다.
