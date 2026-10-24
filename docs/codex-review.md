# Codex 점검 요청 가이드

Backseat을 Codex(또는 다른 AI 에이전트)에게 교차 점검받는 방법과, 그대로 붙여넣을 요청문입니다.

## 준비

1. **Codex 클라우드(ChatGPT 앱/웹의 Codex)**: GitHub 저장소 `JJFlo-kr/backseat`를 연결하고 새 작업을 만든 뒤 아래 요청문을 붙여넣습니다.
   클라우드 환경은 보통 Linux라 Electron 앱 실행·자가 테스트는 못 하고, 정적 리뷰 + `npm test` + `npm run typecheck`까지 가능합니다.
2. **Codex CLI(이 PC)**: `D:\backseat`에서 `codex`를 실행하고 요청문을 붙여넣습니다. Windows에서 돌면 빌드와 자가 테스트까지 할 수 있습니다.
   점검 중에는 PC를 쓰지 않거나, 요청문의 `--selftest-no-scroll`을 지키게 하세요(스크롤 단계는 실제 마우스 휠을 움직입니다).
3. 결과는 **새 브랜치나 PR**로 받으세요. main에 바로 넣지 않게 요청문에 적어 두었습니다. 받은 결과를 Claude에게 보여주면 맞는 지적인지 가려서 반영합니다.

## 붙여넣을 요청문

```text
이 저장소(Backseat, Windows용 Electron + TypeScript 트레이 앱)를 코드 리뷰해 줘.
먼저 AGENTS.md, README.md, PLAN.md를 읽고 구조와 의도를 파악해.

점검 범위 (중요한 순서):
1. 버그: 크래시, 경쟁 상태, 리소스 누수(창·워커·리스너·마이크 트랙), 잘못된 좌표/시간 계산,
   undo/redo가 문서 상태를 깨뜨리는 경우, 오래된 세션 패키지를 못 읽는 경우.
2. 보안: src/main/native/win32.ts와 src/main/send.ts의 창 포커스·키 입력(keybd_event)·클립보드가
   엉뚱한 창에 입력될 수 있는지, Electron 보안 설정(contextIsolation, sandbox, CSP,
   setPermissionRequestHandler), MCP 서버(src/main/mcp/server.ts)의 파일 경로 처리(경로 탈출),
   requests 폴더를 통한 backseat_ask 남용 가능성, 클라우드 STT 키 취급, 설치판(electron-builder) 설정.
3. 전송 대상 판별(src/main/agents.ts, src/main/index.ts의 pickTarget/후보 목록)이 잘못된 창으로
   보낼 수 있는 경우.
4. 음성 정렬(src/shared/align.ts, transcript.ts)의 논리 오류와 테스트로 안 잡히는 경계 사례.
5. 성능: 4K/200% 화면 캡처, 긴 녹음, 스크롤 캡처 스티칭의 메모리·시간.
6. 유지보수: 너무 큰 파일(src/renderer/editor/editor.ts), 중복, 타입 계약(src/shared/types.ts) 위반.

할 수 있으면 실행해서 확인해:
- npm install (electron.exe가 없으면 node node_modules/electron/install.js)
- npm run typecheck, npm test
- Windows라면: npm run build, npm run selftest -- --selftest-no-scroll --selftest-shots=<임시 폴더>
- node scripts/mcp-check.mjs <임시 세션 폴더>
실행 못 한 것은 못 했다고 분명히 적어.

결과 형식 (한국어):
- 발견 사항마다: 심각도(치명/높음/중간/낮음), 파일:줄, 문제 한 줄, 재현 방법 또는 근거, 고치는 방법.
- 확실하지 않은 추측은 "추정"이라고 표시.
- 마지막에 우선순위 상위 5개 요약.

수정 규칙:
- main에 직접 커밋하지 말고 codex/review 브랜치에서 작업해. 수정은 발견 사항별로 작은 커밋으로 나누고
  커밋 메시지에 해당 발견 사항을 적어.
- 확실한 버그만 고치고, 설계를 바꾸는 큰 리팩터링은 제안으로만 남겨.
- UI 문구·brief.md·문서는 한국어를 유지해.
- StykAnimate(GPL) 코드는 가져오지 마.
- 고친 뒤 npm run typecheck와 npm test가 통과해야 해.
```

## 결과를 받은 뒤

- 리뷰 결과(텍스트)나 브랜치 이름을 Claude에게 주고 "Codex 리뷰 검토해서 맞는 것만 반영해줘"라고 하면 됩니다.
- 브랜치로 받았다면 Claude가 그 브랜치를 테스트하고 main에 합칠지 판단합니다.
