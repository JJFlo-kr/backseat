# Backseat (AI 소통기)

화면을 캡처하고, 그 위에 그리면서 말하고, 그대로 AI 코딩 에이전트에게 보내는 Windows 도구.
"backseat driver"에서 이름을 땄다. AI가 운전(코딩)하고, 사용자는 뒷좌석에서 화면을 가리키며 지시한다.

```sh
npm install
npm run build
npm start          # 트레이 상주
```

## 쓰는 법

| 동작 | 키 |
|---|---|
| 영역 캡처 (화면이 멈추고 드래그로 선택) | `Ctrl+Shift+A` |
| 창 캡처 (마우스 아래 창을 클릭) | `Ctrl+Shift+W` — 선택 화면 안에서는 R/W/F로 전환 |
| 편집기 도구 | 펜 P · 텍스트 T · 화살표 A · 사각형 R · 번호 N · 블러 B |
| 녹음 시작/정지 | M (말하면서 그리면 발화가 주석에 자동으로 붙는다) |
| 타임라인 열기 / 재생 / 라이브 | L · Space · End |
| 되돌리기 / 다시 실행 | Ctrl+Z · Ctrl+Shift+Z |
| **전송** (작업하던 에이전트에게) | Enter |
| 저장 / 복사 / 녹화 내보내기 | Ctrl+S · Ctrl+C · Ctrl+E |

전송하면 `Pictures\Backseat\sessions\<id>\` 에 세션 패키지가 생기고(annotated.png, brief.md, strokes.json,
transcript.json, audio.webm, meta.json), 캡처 직전에 쓰고 있던 창(터미널의 Claude Code, Claude 앱, Cursor,
VS Code, 브라우저 채팅)에 브리프 경로가 든 지시문 또는 이미지를 붙여넣는다. Enter는 사용자가 누른다.

## 에이전트 연결 (MCP)

`out/main/mcp-server.js` 가 stdio MCP 서버다. Claude Code라면 프로젝트의 `.mcp.json` 에:

```json
{ "mcpServers": { "backseat": { "command": "node", "args": ["D:/backseat/out/main/mcp-server.js"] } } }
```

툴: `backseat_register`, `backseat_latest`(브리프 + 이미지), `backseat_list`, `backseat_get`, `backseat_wait`(다음 전송까지 대기),
`backseat_ask`(질문을 띄우고 사용자가 그려서 답할 때까지 대기). `integrations/claude-code/SKILL.md` 를 `.claude/skills/backseat/` 에 복사하면 `/backseat` 스킬이 된다.

## 음성 인식

transformers.js(ONNX)로 Whisper를 로컬에서 돌린다. 기본 모델 `onnx-community/whisper-small_timestamped`(한국어 단어 타임스탬프)는
첫 녹음 때 내려받아 `%APPDATA%\backseat\models` 에 캐시된다. 환경변수 `BACKSEAT_STT_MODEL` 로 바꿀 수 있다
(예: `onnx-community/whisper-large-v3-turbo_timestamped`, 더 정확하지만 큼).

## 검증

- `npm test` — 정렬·전사 그룹화 단위 테스트
- `npm run selftest` — 캡처, 창 열거, 선택창·편집기 렌더링, 타임라인 스크럽, undo/redo, 클립보드, 세션 패키지, 브리프 검증.
  `--selftest-wav=<wav>` 를 주면 STT와 음성 레인까지 확인한다.
- `node scripts/mcp-check.mjs <sessionsRoot>` — MCP 서버를 공식 클라이언트로 검증(ask 왕복 포함)

## 주의

- 프로젝트를 Claude 앱의 임시 폴더처럼 가상화된 AppData 아래에 두면 Electron 샌드박스와 Vite 빌드가 깨진다. D:\backseat 같은 일반 폴더에서 작업할 것.
- 설계와 진행 상황은 [PLAN.md](PLAN.md).
