# AI 소통기 (Backseat) — 구현 계획 v0.3

> 화면을 잡고, 그리고, 말하고, 보내면 AI 에이전트가 "무엇을 가리키며 무슨 말을 했는지"를 타이밍까지 이해하고 수정한다.

- 한글명: **AI 소통기**
- 영문명(확정): **Backseat** — "backseat driver"에서. AI가 운전(코딩)하고, 사용자는 뒷좌석에서 화면을 가리키며 지시한다.
- 태그라인: "Point. Talk. Let the AI drive."
- CLI/패키지명: `backseat` (예: `backseat send`, `backseat-mcp`)

---

## 1. 문제와 목표

바이브코딩 중 "저기 저 버튼, 이거 말고 이렇게"를 텍스트로 설명하는 비용이 크다.
지금은 캡처 → 그림판 → 저장 → 붙여넣기 → 설명 타이핑을 수동으로 반복한다.

목표: **단축키 한 번 → (캡처 또는 오버레이) → 그리면서 말하기 → 전송** 으로 끝내고,
에이전트에게는 "이미지 + 주석 목록 + 발화 전사 + 시간축 정렬 결과"를 구조화된 브리프로 넘긴다.

성공 기준
- 캡처부터 에이전트 전달까지 10초 이내, 키보드 입력 0회 가능
- 에이전트가 "3번 동그라미는 로그인 버튼이고, 그때 '더 크게'라고 말함"을 정확히 복원
- Claude Code / Orca / Cursor / Codex 등 어떤 에이전트에도 같은 브리프로 연결
- "전송"을 누르면 **지금 작업 중인 에이전트 세션**에 추가 조작 없이 이미지가 도착

---

## 2. 두 가지 진입점

### 2-A. 캡처 모드 (일반 캡처 도구처럼)
단축키 `Ctrl+Shift+A`(가칭) 또는 트레이 메뉴 → 화면이 어두워지고 캡처 모드 선택.

| 모드 | 동작 |
|---|---|
| 사각형 캡처 | 드래그로 영역 지정. 가이드라인·좌표·크기 표시, 드래그 후 핸들로 미세 조정 |
| 창 캡처 | 마우스를 올리면 창 윤곽이 하이라이트, 클릭으로 해당 창만 캡처. 자식 컨트롤(패널·버튼) 단위 스냅 옵션 |
| 전체 화면 | 모니터 선택(멀티모니터) 또는 전체 |
| 스크롤 캡처 | (M4) 긴 페이지 자동 스크롤 합성 |
| 이전 영역 재캡처 | 직전 사각형 영역으로 바로 캡처(전/후 비교용) |

캡처 직후 **편집 뷰어**가 즉시 열린다(아래 3절).

### 2-B. 오버레이 모드 (라이브 화면 위에 그리기)
단축키 `Ctrl+Shift+Space`로 토글. 화면 전체가 투명 캔버스가 되고 그 밑 화면은 그대로 보임.
- 펜 / 화살표 / 사각형·원 / 번호 뱃지 / 텍스트 / 지우개 / Undo
- 그리기 시작과 동시에 **마이크 녹음 자동 시작**(설정으로 끌 수 있음)
- `Enter` 또는 전송 버튼 → 밑 화면을 캡처하고 주석을 합성 → 패키지 생성 → 전송 → 오버레이 종료
- 전송 전에 편집 뷰어로 넘어가 다듬을 수도 있음(옵션)

두 모드는 **같은 편집기·같은 패키지·같은 전송 경로**를 공유한다. 차이는 "이미지를 먼저 고정하느냐(캡처), 라이브 화면 위에 그리느냐(오버레이)"뿐.

---

## 3. 편집 뷰어 (캡처 후 즉시 열림)

작고 빠른 창. 큰 이미지 편집기가 아니라 "메모 붙여서 보내기"에 최적화.

도구
- 펜(굵기·색 프리셋 3개), 형광펜, 화살표, 사각형·원, 번호 뱃지(자동 증가), 텍스트 박스, 블러/모자이크(민감정보 가리기), 자르기, Undo/Redo
- 텍스트 박스는 클릭 한 번으로 생성, 주석 옆에 붙는 **콜아웃**(번호 뱃지 + 짧은 메모) 지원
- 마이크 버튼: 편집 중에도 녹음 가능. 녹음 중 그린 주석은 타임스탬프가 붙어 발화와 정렬됨
- 하단 메모 입력란: 이미지 전체에 대한 한 줄 지시("이 화면 전체를 다크모드로")

액션 버튼(키보드 단축키 병행)
| 버튼 | 단축키 | 동작 |
|---|---|---|
| 저장 | `Ctrl+S` | 기본 폴더(설정) 또는 다른 이름으로 저장. PNG + 선택 시 brief.md 동봉 |
| 복사 | `Ctrl+C` | 주석 합성 이미지 + 브리프 텍스트를 클립보드로 |
| **전송** | `Enter` / `Ctrl+Enter` | **현재 작업 중인 에이전트**에게 바로 전달 (4절) |
| 대상 선택 전송 | `Ctrl+Shift+Enter` | 에이전트 목록 팝업에서 골라 전송 |
| 고정 | `P` | 편집기를 작은 플로팅 참조창으로 전환(비교하면서 작업) |
| 다시 캡처 | `R` | 같은 영역 재캡처(수정 후 확인용) |

---

## 4. 전송: "지금 작업 중인 에이전트"에게 바로 넘기기

### 4-1. 활성 에이전트 판별 (우선순위)
1. **MCP 연결 중인 에이전트**: `backseat-mcp`에 연결된 세션이 있으면 그 세션. 여러 개면 가장 최근에 툴을 호출한 세션.
   연결 시 에이전트가 `backseat_register(name, cwd, kind)`로 자기 정보를 알려줌 → 트레이에 "현재: Claude Code @ D:\myapp" 표시.
2. **포커스된 터미널/에디터 창**: 캡처 직전 활성 창 제목·프로세스로 추정 (예: Windows Terminal에서 `claude` 실행 중, Cursor 창, Orca 창).
3. **마지막으로 전송한 대상** (사용자가 수동 선택했던 것).
4. 판별 실패 시 대상 선택 팝업.

트레이 메뉴와 편집기 상단에 현재 대상이 항상 보이고, 클릭으로 고정/변경 가능.

### 4-2. 대상별 전달 방식
| 대상 | 방식 |
|---|---|
| MCP 지원 에이전트 (Claude Code, Orca, Cursor, Codex 등) | 패키지를 세션 폴더에 저장 후 `backseat-mcp`가 해당 세션에 "새 브리프 도착" 알림(MCP notification / `backseat_wait` 해제). 에이전트는 `backseat_latest()`로 이미지+브리프 수신 |
| 터미널 기반 에이전트 (MCP 미연결) | 프로젝트 `.backseat/sessions/<id>/`에 저장하고, 포커스된 터미널에 `@.backseat/sessions/<id>/brief.md 읽고 지시대로 수정해줘` 자동 입력 (Enter는 사용자가 치게 두는 옵션 기본) |
| 채팅형 UI (웹 Claude, ChatGPT 등) | 클립보드에 이미지+텍스트 → 포커스 창에 `Ctrl+V` 자동 붙여넣기(옵션) |
| 사용자 정의 | 설정에서 "폴더 저장 + 명령어 실행" 훅 등록 (예: `curl`, 스크립트) |

### 4-3. 전송 후
- 토스트: "Claude Code @ D:\myapp 에 전송됨 · 브리프 보기 · 되돌리기"
- 세션 히스토리에 기록. 같은 이미지로 재전송/다른 대상 전송 가능.

---

## 5. 핵심 산출물: 세션 패키지

하나의 전송 = 하나의 세션 폴더 `.backseat/sessions/<timestamp>/`

```
screenshot.png        원본 캡처(또는 오버레이 밑 화면)
annotated.png         주석 + 번호 뱃지 합성본 (에이전트에게 주는 주 이미지)
strokes.json          주석별 기하 정보 + t_start/t_end (ms, 세션 시작 기준)
audio.wav             녹음 원본(옵션, 전사 후 삭제 가능)
transcript.json       STT 결과, 세그먼트/단어 단위 타임스탬프
brief.md              에이전트가 읽는 최종 브리프 (아래 형식)
meta.json             캡처 모드, 해상도, 모니터, 창 제목/프로세스, 프로젝트 경로, 전송 대상
```

### brief.md 형식(예시)

```md
# Backseat brief 2026-10-23 14:02
캡처: 창 캡처 "localhost:3000 - Chrome" / 프로젝트: D:\myapp / 대상: Claude Code

![annotated](annotated.png)

## 전체 메모
"로그인 화면 1차 피드백"

## 주석 ↔ 발화 (시간순)
1. ① 원 (812,340)-(1010,392) [00:01.2–00:03.0]
   🗣 "이 로그인 버튼이 너무 작아, 한 1.5배 키워줘"
2. ② 화살표 (640,120)→(900,118) [00:04.5–00:06.1]
   🗣 "로고는 이쪽 가운데로 옮기고"
3. ③ 텍스트 "여백 24px" (1100,480) [00:07.0]
   🗣 (해당 발화 없음)

## 전체 전사
"이 로그인 버튼이 너무 작아 한 1.5배 키워줘 로고는 이쪽 가운데로 옮기고 그리고 여기 여백"

## 해석 가이드 (에이전트용)
- 번호 뱃지는 그린 순서. 발화는 해당 주석을 그리는 동안(±1.5초) 말한 내용.
- 좌표는 annotated.png 픽셀 기준. 창 캡처인 경우 창 클라이언트 영역 기준 좌표도 meta.json에 있음.
- 활성 창의 DOM/컴포넌트와 대응시켜 수정할 것.
```

### 시간축 정렬 알고리즘 (v1 규칙 기반)
- 각 주석 A: [t_start, t_end]. 각 전사 세그먼트 S: [s_start, s_end].
- 점수 = 겹치는 길이 + 근접 보너스(간격 ≤ 1.5s). 최고 점수 주석에 세그먼트 귀속.
- 어느 주석과도 겹치지 않는 발화는 "전역 지시"로 분류(예: "전체적으로 다크모드로").
- 지시어("이거", "여기", "저쪽") 포함 세그먼트는 시간상 가장 가까운 주석에 강제 귀속.
- v2: LLM 한 번 호출해 브리프를 자연어 작업 지시로 재작성(옵션).

---

## 6. 아키텍처

```
┌─────────────────────────── Backseat 데스크톱 앱 (Electron + TS) ───────────────────────────┐
│  main 프로세스                                   renderer 창들                              │
│  - 전역 단축키, 트레이, 설정                      - 캡처 선택 창 (사각형/창/전체 선택 UI)       │
│  - 화면/창 캡처 (desktopCapturer + Win32 창 열거)  - 오버레이 창 (투명 always-on-top 캔버스)   │
│  - 오디오 캡처 → STT 어댑터                       - 편집 뷰어 창 (주석 도구, 저장/복사/전송)    │
│  - 활성 에이전트 판별기 (MCP 세션·포커스 창)       - 공통 캔버스 엔진 (스트로크+타임스탬프)      │
│  - 패키지 빌더 (brief.md 생성)                                                              │
│  - 전달 어댑터: MCP 알림 / 터미널 자동입력 / 클립보드 붙여넣기 / 파일 드롭 / 사용자 훅         │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
          │                      │                         │
   .backseat/sessions/        클립보드(이미지+텍스트)      backseat-mcp (stdio MCP 서버, 세션 레지스트리)
          │                                               │
   Claude Code / Orca / Cursor / Codex 등 — 파일 경로 읽기 또는 MCP 툴 호출
```

### 기술 선택(추천)
| 영역 | 선택 | 이유 |
|---|---|---|
| 셸 | Electron + TypeScript | 투명/클릭통과 오버레이, 전역단축키, 트레이가 검증됨. MCP SDK도 Node라 한 언어로 통일 |
| 대안 | Tauri(Rust) | 가볍지만 투명 오버레이·캡처가 플랫폼별 손이 더 감. v2 검토 |
| 캡처 | `desktopCapturer` + DPI 보정. 창 캡처는 Win32 `EnumWindows`/`DwmGetWindowAttribute`로 창 경계 구함(`koffi` 네이티브 바인딩) | 창 하이라이트·정확한 경계·멀티모니터 |
| 활성 창 감지 | `GetForegroundWindow` + 프로세스명 (`active-win` 또는 koffi) | 에이전트 판별, meta.json |
| 자동 입력 | `nut.js` 또는 koffi `SendInput` | 터미널/채팅창에 경로·텍스트 붙여넣기 |
| STT | 어댑터 패턴. 기본 로컬 `whisper.cpp`(word timestamps), 옵션 클라우드(OpenAI/Deepgram/Groq) | 오프라인·프라이버시 기본, 속도 필요시 클라우드 |
| 한국어 | whisper large-v3-turbo 또는 클라우드. 한/영 혼용 코드 용어 사전(핫워드) 지원 | "컴포넌트", "props" 등 인식률 |
| 에이전트 연결 | MCP(stdio) + 파일 드롭 + 클립보드 + 자동입력 | MCP 미지원 도구도 커버 |

### MCP 서버 `backseat-mcp` 툴
- `backseat_register(name, cwd, kind)` → 세션 등록, 활성 대상 후보가 됨
- `backseat_latest()` → 최신 브리프 + 이미지(base64) 반환
- `backseat_list(n)` / `backseat_get(id)`
- `backseat_wait(timeout)` → 사용자가 다음 전송을 할 때까지 대기(에이전트가 "그려서 알려줘" 가능)
- `backseat_ask(question)` → 오버레이/편집기에 질문 띄우고 사용자가 그림+음성으로 답변 (양방향)
- 서버 → 클라이언트 notification `backseat/brief_ready` 로 전송 즉시 알림

### Claude Code 통합
- `.claude/skills/backseat/SKILL.md`: `/backseat` 호출 시 `backseat_latest`로 받아 활성 창·프로젝트와 매칭하여 수정
- 세션 시작 훅에서 `backseat_register` 자동 호출(MCP 서버 설정 템플릿 제공)
- Orca·Cursor·Codex는 각자 규약(rules 파일, mcp.json)에 맞춘 템플릿 동봉

---

## 7. 마일스톤

| 단계 | 범위 | 완료 기준 |
|---|---|---|
| M0 스파이크 (3~4일) | 사각형 캡처 + 편집 뷰어(펜·텍스트) + 저장/클립보드 복사 + 트레이 + 단축키 | 캡처→메모→Ctrl+V로 Claude Code에 붙여넣어 수정 성공 |
| M1 캡처 완성 (1주) | 창 캡처(윤곽 하이라이트), 전체/모니터, 화살표·도형·번호뱃지·블러·자르기, 메모 입력란, strokes.json + brief.md(음성 없이), 파일 드롭 전송, **활성 에이전트 판별 + 터미널 자동입력 전송** | 편집기에서 Enter 한 번으로 Claude Code가 브리프 읽고 좌표 기반 수정 |
| M2 오버레이 + 음성 (1~2주) | 투명 오버레이 모드, 녹음, whisper.cpp 어댑터, 타임스탬프 정렬, 브리프에 발화 병합, 한국어 핫워드 | "이거 키워" + 동그라미 조합이 올바른 요소 수정 |
| M3 에이전트 연결 (1주) | backseat-mcp(register/latest/wait/ask + 알림), /backseat 스킬, Orca·Cursor 설정 템플릿, 대상 선택 팝업, 사용자 훅 | MCP 툴만으로 전체 루프 동작, 대상 자동 판별 적중 |
| M4 다듬기 | 스크롤 캡처, 이전 영역 재캡처, 고정 참조창, 세션 히스토리, 설정 UI, 클라우드 STT 옵션, 자동 업데이트 | 하루 종일 써도 거슬리지 않음 |
| 이후 | macOS 지원(Tauri 재검토), 짧은 화면 녹화(GIF)로 "동작" 설명, 브리프 LLM 재작성 | |

---

## 8. 리스크와 대응
- **오버레이 클릭 통과/포커스 문제**(Windows): `setIgnoreMouseEvents(true, {forward:true})` 토글로 펜 OFF 시 통과. 전체화면 게임/보안 창 위에서는 캡처 제한 → 안내 메시지.
- **창 캡처 경계 오차**: DWM 그림자 포함 영역과 실제 창 영역이 다름 → `DWMWA_EXTENDED_FRAME_BOUNDS` 사용. 최소화·가려진 창은 `PrintWindow`로 대체.
- **HiDPI 좌표 불일치**: 캡처 스케일 팩터를 meta.json에 저장, 모든 좌표는 이미지 픽셀 기준으로 정규화.
- **활성 에이전트 오판**: 항상 대상이 UI에 보이고 한 클릭으로 바꿀 수 있게. 자동입력은 Enter를 치지 않는 것이 기본값이라 오전송 시 지울 수 있음.
- **자동입력이 엉뚱한 창에 들어감**: 전송 직전 포커스 창이 판별 시점과 같은지 재확인, 다르면 클립보드 복사로 폴백하고 토스트로 알림.
- **STT 지연**: 로컬 whisper는 10초 음성에 1~3초. 전송 직후 브리프를 먼저 쓰고 전사는 비동기 갱신(에이전트는 `backseat_latest`가 ready 될 때까지 대기).
- **발화-주석 오귀속**: 브리프에 타임스탬프를 그대로 노출해 에이전트가 재판단 가능하게. 사용자는 전송 전 편집기에서 드래그로 재배정.
- **프라이버시**: 기본 로컬 처리, 블러 도구, 오디오 자동 삭제 옵션, 클라우드 STT는 명시적 opt-in.

---

## 9. 결정 필요 사항
1. 플랫폼: Windows 우선(현재 환경) → macOS는 M4 이후. 동의?
2. 셸: Electron(추천) vs Tauri.
3. STT 기본값: 로컬 whisper.cpp(느리지만 무료·오프라인) vs 클라우드(빠름, 키 필요).
4. 영문명: Backseat (확정).
5. 저장소 구조: 단일 모노레포 `backseat/` 아래 `apps/desktop`, `packages/mcp`, `packages/skill`.
6. 터미널 자동입력 시 Enter까지 자동으로 칠지(기본: 안 침).

## 10. M0 진행 상황 (2026-10-23 완료)
- [x] `backseat/` 프로젝트, Electron 45 + electron-vite 6 + TypeScript 7 (`npm run build`, `npm start`)
- [x] 전역 단축키 `Ctrl+Shift+A` → 화면 동결 + 어둡게 + 사각형 드래그 선택 (디스플레이마다 창 하나, Esc 취소)
- [x] desktopCapturer로 전체 디스플레이 캡처 후 선택 영역 크롭 (scaleFactor 보정, 디스플레이 ID 매칭)
- [x] 편집 뷰어: 펜(3색·2굵기)·텍스트(한글 IME 지원)·Undo, 메모 입력란, 저장(PNG + 주석 있으면 brief.md), 복사(이미지+메모 클립보드)
- [x] 트레이 아이콘(클릭=캡처), 종료, 단일 인스턴스, `--capture` 인자
- [x] 자가 테스트 `electron . --selftest --selftest-out=<png> --selftest-shots=<dir>`: 캡처→크롭→선택창·편집기 렌더링→클립보드→brief 검증

### M0에서 배운 것
- Electron 45의 클립보드는 W3C 스타일 `clipboard.write([new ClipboardItem({'image/png': Blob, 'text/plain': string})])`.
- 프로젝트가 Claude 임시 폴더 아래 있으면 샌드박스 자식 프로세스가 `node_modules/electron/dist`를 못 읽음 → `icacls <dist> /grant *S-1-15-2-1:(OI)(CI)(RX) /T`. 일반 폴더로 옮기면 불필요.
- 주석 타임스탬프(tStart/tEnd)는 M0부터 기록 중이라 M2 음성 정렬에 바로 쓸 수 있음.

## 11. 타임라인 (2026-10-23, StykAnimate 설계 연구 반영)

StykAnimate(GPL-3.0, github.com/filippocalippo/StykAnimate-App)를 읽기 전용으로 분석했다. 코드는 GPL이라 한 줄도 가져오지 않고 설계 패턴만 우리 방식으로 다시 구현했다. 분석 결과 StykAnimate에는 음성-스트로크 정렬 기능이 없고(오디오는 독립 클립), 드로잉 히스토리는 픽셀 타일 diff라 스트로크 타임스탬프를 저장하지 않는다. 정렬은 우리 고유 설계다.

### 적용한 것 (구현 완료)
| 패턴 | 출처 | Backseat 구현 |
|---|---|---|
| 시간의 진실은 하나의 단조 클럭 | 오디오 초 단위를 진실로 두고 tick은 파생 | `t0 = performance.now()` 기준 ms. 포인터 이벤트는 `e.timeStamp - t0`로 점마다 기록(`Annotation.stroke.times[]`) |
| 공유 시간축 위의 레인 | 오디오 레인이 레이어와 같은 ruler/zoom/playhead 공유 | `TimeAxis(xOf/tOf)` 하나로 펜·텍스트 레인, 눈금, 플레이헤드를 Canvas 2D에 그림 (`src/renderer/editor/timeline.ts`) |
| 스크럽은 RAF당 seek 한 번 | `pendingSeek` + `evaluate:false` | `pendingT`를 RAF에서 한 번 소비, 릴리스 때 정확한 t 확정. 렌더는 순수 `drawAnnotationAt(t)` |
| hold 시맨틱 | 키는 다음 키까지 유지 | 막대 `[tStart,tEnd]` 뒤로 연한 hold 꼬리 → "이 말이 어느 화면 상태에 대한 것인지" 보임 |
| Undo = 라벨 + before/after 스냅샷 | `{kind,label,before,after}` 스택, 상한 | `History<readonly Annotation[]>`(상한 100). 주석 배열은 불변이라 스냅샷은 참조 하나. 되돌리기/다시 실행 버튼 툴팁에 라벨 표시 |
| 드래그는 미리보기, 커밋은 한 번 | gesture patch → release 시 명령 1개 | 스트로크는 그리는 동안 캔버스에만 그리고 pointerup에서 `commit('펜')` 한 번 |
| 단축키 레지스트리 | command id + 기본 바인딩 + context, `e.code` 매칭, 입력 중 무시 | `Hotkeys` 클래스: 툴팁을 같은 테이블에서 파생(`data-command`), 'global'(Ctrl+S)과 'editor' 구분 |
| 결정적 샘플링 내보내기 | 프레임 i의 시각을 고정하고 같은 renderAt 사용, backpressure | 녹화 내보내기(Ctrl+E): `canvas.captureStream(30)` + MediaRecorder(WebM), 매 프레임 `drawAnnotationAt(t)` |
| Progressive disclosure | 오디오 UI는 기본 닫힘, 점 표시 | 타임라인은 기본 닫힘(L 키/버튼), 주석이 있으면 버튼에 빨간 점 |
| 비대칭 정렬 윈도우 (우리 설계) | — | `alignSegments`: 윈도우 `[tStart−1.5s, tEnd+0.8s]`(말을 먼저 하고 그림), coverage 점수, 지시어 가중치, `confidence`, 수동 링크(`manual`)가 자동을 덮어씀. 테스트 18개 |

### 다음에 적용할 것 (M2 음성)
- 재생 마스터 클럭 = 오디오 (`audio.currentTime`), 드로잉은 그 시각을 따라 렌더 → 드리프트 구조적으로 제거
- 스크럽 시 ±40ms 오디오 조각 재생(100ms 스로틀, 이전 요청 취소) → 귀로 정렬 검증
- 음성 레인 추가(세그먼트 막대 + 단어), 세그먼트를 다른 주석에 드롭 = `manual` 링크 명령 1개(시간은 안 바꿈). 스냅 후보는 `annotationBoundaries()` + `nearestBoundary()`
- 녹음 시작 시각과 첫 샘플 시각의 차 `audioOffsetMs`를 패키지에 저장하고 ±ms 미세 조정 UI
- brief.md에 링크별 `source(auto/manual)`과 `confidence` 기록 → 에이전트가 불확실한 지시를 구분
- GIF는 MIT 인코더(gifenc 계열)로 2패스 전역 팔레트. Before/After 비교는 onion 응용(오버레이·와이프·difference)

### 적용하지 않는 것
WebGPU 렌더러, 타일 기반 undo 스필, 2만 트랙 가상화, Simple/Advanced 이중 타임라인, 오디오 믹서, Pivot 호환 규칙. 벡터 스트로크 수십 개 규모에는 과하다.

## 12. M1 진행 상황 (2026-10-23)
- [x] 창 캡처 모드: 선택 창에서 W(창)/R(사각형)/F(전체) 전환, 창 위에 마우스를 올리면 윤곽 하이라이트 + 제목·크기, 클릭으로 캡처. 창 목록은 koffi로 Win32 `GetTopWindow/GetWindow` z-order 순회 + `DWMWA_EXTENDED_FRAME_BOUNDS`(DIP 변환은 `screen.screenToDipRect`), cloaked·툴윈도우·최소화 창 제외. 단축키 `Ctrl+Shift+W`는 창 모드로 바로 시작
- [x] 화살표(A)·사각형(R)·번호 뱃지(N, 배열 순서로 자동 번호)·블러(B, 베이스 픽셀 모자이크) 도구. 스크럽/재생에서 화살표·사각형은 진행도에 따라 자람
- [x] 세션 패키지: `Pictures/Backseat/sessions/<id>/` 에 annotated.png, brief.md, strokes.json, meta.json + `latest.txt` 포인터 (`src/main/sessions.ts`)
- [x] 활성 에이전트 판별: 캡처 직전 전경 창의 프로세스·제목으로 분류 (`src/main/agents.ts`: 터미널+제목 'claude' → Claude Code, claude.exe → Claude 앱, cursor/code/windsurf, 브라우저 채팅). 편집기 상단에 "→ 대상" 표시
- [x] 전송(Enter / Ctrl+Enter): 패키지 저장 → 클립보드(터미널은 경로 지시문 텍스트, 채팅 UI는 이미지+텍스트) → 편집기 숨김 → `SetForegroundWindow`(Alt 탭 트릭) → 전경 확인 → Ctrl+V. Enter는 기본으로 치지 않음. 포커스 실패 시 클립보드 복사로 폴백하고 메시지로 알림
- [x] 자르기(crop) 도구 — M5에서 구현 (17절)
- [ ] 실제 붙여넣기 경로는 사람이 확인 필요(자가 테스트는 패키지 생성·클립보드·판별까지만 검증)

### M1 노트
- 자르기 외 M1 항목은 전부 들어갔고 자가 테스트로 창 열거(3개), 전경 창 판별, 대상 분류, 브리프의 6종 주석 서술, 패키지 4개 파일을 확인했다.
- `.backseat/sessions/` 를 프로젝트 안에 쓰려면 에이전트의 작업 폴더를 알아야 한다. 다른 프로세스의 cwd는 권한 없이 얻기 어려워 M1은 Pictures 아래 고정 경로 + 절대 경로 지시문으로 간다. M3의 `backseat_register(cwd)` 로 해결.

## 13. M2 음성 (2026-10-23 완료)
- [x] 편집기 마이크(M): MediaRecorder(webm/opus) → AudioContext(16k)로 디코드 → 메인으로 PCM 전송. `autoRecord` 설정이면 편집기 열릴 때 자동 시작
- [x] STT: whisper.cpp 사이드카 대신 **transformers.js(ONNX) 워커 스레드**를 택했다. npm 의존성만으로 설치되고 네이티브 빌드가 없다. 기본 모델 `onnx-community/whisper-small_timestamped`(한국어 단어 타임스탬프, 8초 음성 ≈ 3초). `whisper-small`(일반)은 cross-attention이 없어 단어 타임스탬프가 안 된다. 모델은 첫 사용 때 내려받아 `userData/models`(개발 시 `.cache/hf`)에 캐시. `BACKSEAT_STT_MODEL`로 교체 가능
- [x] 단어 → 문장 세그먼트 그룹화(구두점·700ms 침묵, `src/shared/transcript.ts`, 테스트 5개). "1" + ".5팩" 같은 조각은 붙여 씀
- [x] 음성 레인: 세그먼트 막대 + 링크 번호 뱃지(수동은 흰색), 드래그해서 주석에 떨어뜨리면 수동 링크(히스토리 1단계), 음성 레인 빈 곳에 놓으면 자동으로 복귀
- [x] 재생 마스터 클럭 = 오디오 `currentTime`, 스크럽 시 90ms 조각 재생(120ms 스로틀)
- [x] brief.md: 주석마다 🗣 줄(자동/수동, 신뢰도), 전역 지시, 전체 전사, 해석 가이드. 패키지에 `audio.webm`, `transcript.json`(alignment 포함)
- [ ] `audioOffsetMs` 미세 조정 UI — 현재는 MediaRecorder `start` 이벤트 시각을 기준으로 쓰며 실측 오차가 작아 M5로 미룸

## 14. M3 에이전트 연결 (2026-10-23 완료)
- [x] `backseat-mcp` stdio 서버 (`out/main/mcp-server.js`, Electron 없이 Node로 실행): `backseat_register / latest / list / get / wait / ask / agents`. 브리프는 텍스트, 이미지는 MCP image content로 같이 반환
- [x] 앱 ↔ 서버 통신은 파일 기반: `<sessionsRoot>/registry.json`(등록 에이전트, pid 생존 검사로 정리), `requests/*.json`(질문), 세션 폴더 감시(`fs.watch` + 1초 폴링). 서버는 `%APPDATA%\backseat\config.json`의 `sessionsRoot`를 읽음
- [x] `backseat_ask`: 서버가 요청 파일 작성 → 앱이 Windows 알림 표시 → 클릭하면 캡처 시작, 편집기 대상 바에 ❓ 질문 표시 → 전송 시 `meta.json.requestId`로 매칭되어 서버가 응답 반환
- [x] MCP로 등록된 에이전트는 전송 대상에 합쳐짐: 앞에 터미널이 있으면 "backseat_latest로 읽어줘" 한 줄을 붙여넣고, 없으면 클립보드 + 파일
- [x] `integrations/claude-code/SKILL.md`(/backseat 스킬), `mcp.json` 템플릿. 검증: `scripts/mcp-check.mjs`가 공식 MCP 클라이언트로 7개 툴, 등록, 최신(텍스트+이미지), 대기 타임아웃, ask 왕복을 확인
- [ ] Orca·Cursor·Codex는 같은 `mcp.json`으로 붙지만 실제 환경에서 미검증

## 15. M4 마무리 (2026-10-23)
- [x] 설정 `%APPDATA%\backseat\config.json` (`src/main/config.ts`): 자동 녹음, 전송 후 Enter, STT 모델·언어, 단축키 2개, 세션 폴더. 트레이 메뉴에서 체크박스로 토글, "설정 파일 열기"
- [x] 트레이 메뉴: 영역 캡처, 창 캡처, 마지막 영역 다시 캡처(전/후 비교용), 세션 폴더 열기, 종료
- [x] 고정(📌, Ctrl+P): 편집기를 480px 항상-위 참조창으로 바꾸고 전송 후에도 닫지 않음
- [x] 렌더러 권한: 마이크·클립보드는 우리 창에서만 묻지 않고 허용
- [x] electron-builder NSIS 패키징(`npm run dist`): koffi·onnxruntime·transformers는 asarUnpack
- [x] 자르기, 스크롤 캡처, 클라우드 STT 옵션, Before/After 비교 뷰 — M5로 구현 (17절)
- [ ] `audioOffsetMs` 미세 조정 — 실측 오차가 작아 보류

## 16. 전체 검증 방법 (현재 기준)
1. `npm test` — 단위 테스트 33개 (정렬 18, 전사 그룹화 5, 스크롤 스티칭 4, 클라우드 STT 어댑터 6 — 모의 HTTP 서버 포함)
2. `npm run selftest -- --selftest-wav=<한국어 wav> --selftest-shots=<dir>` — 캡처·창 열거·전경 창·대상 판별·선택창·편집기(스트로크 2개, 타임라인, 스크럽, undo/redo)·**자르기(캔버스 크기·주석 좌표·meta.rectPx 이동, undo 복원, 브리프 자르기 줄)**·**전/후 비교(O 키, 겹치기/와이프/차이 레이어 픽셀, 브리프 한 줄, Esc 해제)**·마이크 녹음→STT·음성 레인 주입·**스크롤 캡처(자체 긴 페이지 창을 실제 휠로 스크롤해 이어붙인 높이·폭)**·**클라우드 STT(로컬 모의 서버: 멀티파트·Bearer 키·verbose_json 파싱, 키 없으면 네트워크 전 거부)**·클립보드·브리프(6종 주석 + 🗣)·세션 패키지(audio/transcript/requestId) 검증, 스크린샷 10장(selector, editor, editor-timeline, editor-scrub, editor-crop-drag, editor-crop, editor-compare-{overlay,wipe,diff}, editor-speech) + scroll.png
3. `node scripts/mcp-check.mjs <sessionsRoot>` — MCP 툴 7개, ask 왕복
4. 사람이 확인할 것: 실제 터미널 창에 붙여넣기, 실제 마이크 발화의 정렬 품질, 설치 파일 실행, 실제 브라우저·터미널에서의 스크롤 캡처(고정 헤더·가상 스크롤 페이지), 실제 OpenAI 키로 클라우드 STT 한 번

## 17. M5 (2026-10-23)
- [x] 자르기 도구(C): 편집기에서 드래그한 영역만 남긴다. 문서(`Doc`)에 `crop`(원본 px 기준 사각형)이 들어가 히스토리 1단계로 되돌릴 수 있고, base/cmp/ink 캔버스가 원본 이미지(`orig`)에서 다시 그려진다. 모든 주석 좌표는 자른 원점만큼 이동하고 완전히 바깥인 주석은 제거(번호 뱃지 재번호, 발화 링크 인덱스 재매핑). 내보낼 때 `meta.rectDip/rectPx`는 잘린 영역 기준으로 다시 계산하고 `meta.crop`에 원본 기준 사각형을 남긴다. brief.md에 "자르기: 원본 캡처의 (x,y) w×h px만 남김" 한 줄.
- [x] 스크롤 캡처(선택 화면 S 모드): 창을 클릭하면 선택창이 닫힌 뒤 `src/main/scroll.ts`가 Win32 `SendInput`(MOUSEEVENTF_WHEEL, 커서를 창 안에 놓고)으로 휠을 돌리며 `desktopCapturer`로 디스플레이를 연속 캡처하고, `src/shared/stitch.ts`가 이전 프레임과 새 프레임의 겹침을 픽셀 상관(상단 25%는 고정 헤더로 간주해 제외, 평균 절대 오차 최소 오프셋)으로 찾아 새 행만 이어붙인다. 같은 프레임이 오면 끝, 설정 `scrollMaxHeightPx`(기본 16000)·80장 상한, 진행 중 Esc(globalShortcut)로 취소. SendInput이 막히면 `WM_MOUSEWHEEL` PostMessage로 대체. 끝나면 휠을 되돌려 원래 위치로. `meta.mode='scroll'`, `meta.scroll={frames, viewportPx}`.
- [x] 클라우드 STT: `src/main/stt/index.ts`의 `transcribe()`가 설정 `sttBackend`('local' 기본 | 'openai')로 분기. `src/main/stt/openai.ts`가 PCM→WAV 멀티파트로 `<sttApiBase>/audio/transcriptions`(verbose_json, word+segment timestamps)에 POST하고 단어 타임스탬프를 `toTranscript`로 문장 세그먼트화(단어가 없으면 API 세그먼트 그대로). 키는 환경변수 `BACKSEAT_STT_API_KEY`만 읽고(`sttApiKey()`) config.json에는 쓰지 않는다. 설정: `sttApiBase`(기본 https://api.openai.com/v1), `sttCloudModel`(기본 whisper-1).
- [x] Before/After 비교(O): 트레이 "마지막 영역 다시 캡처"로 열 때 `sessions/latest.txt`가 가리키는 이전 패키지의 annotated.png를 `EditorInit.compare`로 넘긴다. 편집기는 base와 ink 사이의 `#cmp` 캔버스에 겹치기(불투명도 슬라이더)·와이프(세로선 위치 슬라이더, 왼쪽 이전/오른쪽 현재)·차이(globalCompositeOperation 'difference') 세 모드로 그리며, 자르기 후에도 같은 영역이 대응된다. 내보내는 이미지에는 들어가지 않고, 비교를 한 번이라도 켰으면 `payload.compare`로 brief.md에 "이전 캡처와 비교: 세션 <id> (annotated.png) · <모드> 모드 · 달라진 픽셀 N%" 한 줄만 기록한다(2px 샘플링, 채널 합 차이 48 초과 비율).
- 스티칭 세부: 이어붙일 때 창 테두리·상태줄처럼 움직이지 않는 하단 행(footer)은 이음새마다 복사하지 않고 마지막에 한 번만 붙인다. 휠은 1노치(120)의 분수 델타로 뷰포트의 약 1/3씩 보내고(Chromium 계열은 정밀 스크롤을 받음, 노치 단위만 받는 앱은 같은 프레임이 3번 오면 끝으로 판단), 프레임은 두 번 연속 같은 그림이 잡힐 때까지(부드러운 스크롤 종료) 기다린 뒤 비교한다. 자가 테스트: 520×420 창 70행 페이지 → 18장, 2610 px(상한 2600), 약 20초.
- 남은 것: `audioOffsetMs` 미세 조정, 세로 스크롤바의 아래 화살표가 이음새마다 오른쪽 가장자리에 남는 것(열 단위 마스킹 필요), 가상 스크롤(내용을 재사용하는 리스트)에서의 스티칭 품질, 비교 뷰의 수평 정렬 보정(스크롤 위치가 다른 재캡처)


## 18. 사용 피드백 1라운드 (2026-10-24)
실제 사용으로 브리프 세 건이 들어왔다(텍스트 주석 8개, 음성 지시 1건).
- [x] 텍스트 가독성(판 배경, 내장 폰트 6종, 글꼴·크기·배경 선택), 텍스트 이동·편집, 지우개(E), 펜 굵기 슬라이더 — 반영
- [x] 전송 대상이 없을 때 편집기가 조용히 닫히던 문제 — 열어 둔 채 "클립보드에 복사" 안내, 직전 대상 재사용
- [x] 실제 발화(16초)가 전사되어 전역 지시로 브리프에 들어오는 것 확인
- [ ] 미해결: 앱 시작 후 **첫** Ctrl+Shift+A에서 선택 창이 흰 화면으로 남고, 단축키를 한 번 더 눌러(취소) 없앤 뒤부터는 정상.
  - 의심: src/main/selector.ts 가 did-finish-load 에서 바로 show() 하는데, 렌더러 콜드 스타트(4K@200%에서 JPEG 약 3MB 전달)에는 첫 페인트 전에 창이 떠서 흰 상태로 멈춤. 렌더러 로그가 없어 확정 못 함.
  - 다음 단계: userData/backseat.log 파일 로거로 렌더러 console·render-process-gone 기록, 선택 창은 ready-to-show 에서 표시하고 3초 안에 안 뜨면 강제 표시+로그,  로 띄운 뒤 3초 후 화면을 찍어 재현. 임시 우회: 앱을 켠 직후 한 번 캡처를 열었다 취소.
