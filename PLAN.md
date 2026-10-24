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
1. `npm test` — 단위 테스트 48개 (정렬·전사 그룹화·스크롤 스티칭·클라우드 STT 어댑터(모의 HTTP 서버)·팔레트·전송 대상 판별, 19절)
2. `npm run selftest -- --selftest-wav=<한국어 wav> --selftest-shots=<dir>` — 캡처·창 열거·전경 창·대상 판별·선택창·편집기(스트로크 2개, 타임라인, 스크럽, undo/redo)·**자르기(캔버스 크기·주석 좌표·meta.rectPx 이동, undo 복원, 브리프 자르기 줄)**·**전/후 비교(O 키, 겹치기/와이프/차이 레이어 픽셀, 브리프 한 줄, Esc 해제)**·마이크 녹음→STT·음성 레인 주입·**스크롤 캡처(자체 긴 페이지 창을 실제 휠로 스크롤해 이어붙인 높이·폭)**·**클라우드 STT(로컬 모의 서버: 멀티파트·Bearer 키·verbose_json 파싱, 키 없으면 네트워크 전 거부)**·**텍스트 꾸미기(여러 줄·배경색·윤곽선·그림자·굵게/기울임·재편집)**·**색 팝오버(팔레트·최근 색·스포이트 대체 경로)**·**전송 대상 메뉴(Ctrl+T, 고정)**·**툴바 3줄이 820px에 들어가는지**·클립보드·브리프(6종 주석 + 🗣)·세션 패키지(audio/transcript/requestId/screenshot.png) 검증, 스크린샷 17장(selector, editor, editor-timeline, editor-scrub, editor-crop, editor-compare-{overlay,wipe,diff}, editor-speech, editor-text-typed, editor-text, editor-text-live, editor-text-edit, editor-text-edit2, editor-colors, editor-colors-textbg, editor-target-menu) + scroll.png
3. `node scripts/mcp-check.mjs <sessionsRoot> [mcp-server.js]` — MCP 툴 7개, includeOriginal, ask 왕복. **sessionsRoot는 자가 테스트의 임시 폴더를 쓸 것**(실제 폴더에 쓰면 떠 있는 트레이 앱이 ask 요청을 받아 캡처를 띄울 수 있음). 두 번째 인자로 설치판 `resources\app.asar.unpacked\out\main\mcp-server.js`를 검사
4. 설치판: `npm run dist` 후 `dist\win-unpacked\Backseat.exe --selftest --selftest-no-stt --selftest-no-scroll`
5. 사람이 확인할 것: 실제 터미널 창에 붙여넣기, 실제 마이크 발화의 정렬 품질, 설치 파일 실행, 실제 브라우저·터미널에서의 스크롤 캡처(고정 헤더·가상 스크롤 페이지), 실제 OpenAI 키로 클라우드 STT 한 번

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
  - 다음 단계: userData/backseat.log 파일 로거로 렌더러 console·render-process-gone 기록, 선택 창은 ready-to-show 에서 표시하고 3초 안에 안 뜨면 강제 표시+로그, electron . --capture 로 띄운 뒤 3초 후 화면을 찍어 재현. 임시 우회: 앱을 켠 직후 한 번 캡처를 열었다 취소.


## 19. 사용 피드백 2라운드 (2026-10-24)

### 19.1 설치판이 기본 실행 방식
- README 첫 절을 "설치와 실행(기본)"으로: 설치 파일 → 시작 메뉴/바탕화면 Backseat → 트레이. 개발 실행은 아래로.
- MCP 서버: 일반 Node는 app.asar 안을 못 읽는다. main 빌드에서 `@modelcontextprotocol/sdk`·`zod`를 외부화하지 않고 묶고(`externalizeDepsPlugin({ exclude })`), `out/main/mcp-server.js`와 `out/main/chunks/**`를 `asarUnpack`으로 풀어 `resources\app.asar.unpacked\out\main\mcp-server.js`를 `node`로 실행. 트레이 "에이전트 연결 설정(MCP) 복사"가 현재 설치 경로로 `.mcp.json` 조각을 클립보드에 넣는다.

### 19.2 로그인 시 자동 시작
- `config.launchAtLogin`(설치판 기본 true, 개발 실행 false) → 시작 시와 트레이 체크박스 토글 때 `app.setLoginItemSettings({ openAtLogin, path: process.execPath })`. 개발 실행(`electron .`)은 등록하지 않고 메뉴 항목을 비활성("설치판에서만").

### 19.3 텍스트 배경 이름 — 후보와 참고 제품
| 후보 (라벨 / 선택지) | 쓰는 곳 |
|---|---|
| 글자 효과: 배경 상자 / 윤곽선 / 효과 없음 | Canva "효과(Effects)" 패널의 배경·윤곽선·없음, PowerPoint "텍스트 효과" |
| 텍스트 배경: 켜기/끄기 (A 버튼 토글) | 인스타그램 스토리·카카오톡 사진 편집의 글자 배경 토글 |
| 채우기 / 윤곽선 | Snagit 텍스트·콜아웃 속성(Fill, Outline), PowerPoint "도형 채우기 / 텍스트 윤곽선" |
| 획(Stroke) | Photoshop 레이어 스타일 "획" |
| 텍스트 외곽선 / 그림자 / 배경색 | ShareX 주석 도구 텍스트 옵션 |
| 말풍선 / 라벨 | Snagit 콜아웃, Snipaste 텍스트 상자 |
- 선택: **"글자 효과" + "배경 상자 / 윤곽선 / 효과 없음"**. "배경"만 쓰면 이미지 배경과 헷갈리고, "채우기"는 글자색과 헷갈림. 각 버튼에 "가" 미리보기 칩과 설명 툴팁.
(위 명칭은 각 제품의 일반적인 UI 표기 기준이며, 판·메뉴 위치는 버전마다 다를 수 있음)

### 19.4 캡처 원본과 Backseat 주석 구분 (AI용 태그)
- 세션 패키지에 주석 없는 원본 `screenshot.png`(블러는 적용된 상태 — 민감정보 보호) 추가. 편집기가 `ExportPayload.basePngDataUrl`로 넘긴다.
- annotated.png 안의 Backseat 글자는 왼쪽 위에 보라(#6E56CF) "B" 표시, 번호 원은 보라 바깥 테두리 — 화면 원래 글자·아이콘과 구분되는 고정 표식.
- brief.md: 맨 위 `> 주의:` 한 줄(그린 것은 사용자 추가, 원본은 screenshot.png), 주석 섹션 이름 "Backseat 주석(사용자 추가)", 해석 가이드는 최대 3줄로 한 번만, 시간 구간은 음성이 있을 때만, 색은 여러 색을 썼을 때만, "전체 전사" 중복 섹션 제거(transcript.json 안내 한 줄). 음성이 있는 브리프에서 특히 짧아진다(전사 중복·주석별 시간 제거); 음성 없는 브리프는 주의 줄만큼 늘고 나머지는 비슷.
- MCP `backseat_latest/get/wait/ask`: 이미지 앞에 "이 이미지의 주석은 사용자가 Backseat로 그린 것" 안내, `includeOriginal: true`면 screenshot.png도 붙인다. 채팅 앱 붙여넣기 문구 앞에 `[Backseat 주석 포함]`.

### 19.5 텍스트 배경색과 흔한 텍스트 기능
참고한 앱의 공통 기능:
| 기능 | 쓰는 곳 |
|---|---|
| 글자 배경(상자) 켜기·색 바꾸기 | 인스타그램 스토리(A 버튼으로 배경 순환), 카카오톡 사진 편집, Snagit 콜아웃 채우기 |
| 배경 투명도 | Snagit·PowerPoint(채우기 투명도), Canva(효과 → 배경 투명도) |
| 글자색 ↔ 배경색 반전 | 인스타그램 스토리(배경 토글 시 글자/배경 색 뒤바뀜) |
| 윤곽선 색 | PowerPoint 텍스트 윤곽선, Photoshop 획, ShareX 텍스트 외곽선 |
| 그림자 | Snagit·Canva·PowerPoint 그림자 효과, ShareX 텍스트 그림자 |
| 굵게·기울임 | iOS 마크업 텍스트, Snipaste, PowerPoint |
| 여러 줄 | 모든 앱 (Snipaste·Snagit은 Enter=줄바꿈, 카톡/인스타는 줄바꿈 후 완료 버튼) |
- 구현: 텍스트 도구일 때 세 번째 줄 `#textbar`(글자 효과 · 배경색+자동+불투명도 · ⇄ 반전 · 윤곽선 색 · 그림자), 두 번째 줄에 B/I. Enter = 완료, Shift+Enter = 줄바꿈(빠른 메모가 주 용도라 완료를 Enter에 둠). 정렬 옵션은 넣지 않음(왼쪽 정렬).
- `Annotation.text`에 optional `bg, bgOpacity, outline, shadow, bold, italic` — 없으면 1라운드 모양 그대로라 기존 패키지 호환.

### 19.6 색 팔레트
참고: Excalidraw(5색 빠른 선택 + 확장 팔레트 + 최근 색 + hex 입력), tldraw(12색 고정 큐레이션 팔레트), Figma(문서 색·최근 색·스포이트), Canva(문서 색·기본 팔레트·+ 직접 선택), Notion(10색 이름 붙은 차분한 색), Snagit(빠른 스타일 + 스포이트).
- 색 버튼 하나(현재 색 점 + ▾) → 팝오버: 팔레트 탭 4종(선명 = Radix 계열 12색, 차분 = tldraw/Excalidraw 계열 12색, 파스텔 12색, 모노 9단계), 최근 사용 6색, 직접 선택(`<input type=color>`), hex 입력, 스포이트(Chromium `EyeDropper` API; 없으면 캡처 화면 클릭으로 픽셀 읽기).
- 펜·도형·텍스트 색, 배경 상자 색, 윤곽선 색이 같은 팝오버를 쓴다. 마지막 탭과 최근 색은 localStorage.

### 19.7 전송 대상 오판 (사용자 신고)
- 증상: 캡처 직전 창이 ChatGPT 앱(Codex)인데 전송이 Claude 앱으로 감. 사용 방식(대상 창에 포커스를 두고 단축키)은 맞았다.
- 원인: `classifyTarget`이 `ChatGPT.exe`를 몰라 null → "직전 대상" 폴백이 이전의 Claude 앱을 씀. 게다가 `lastTarget`에 "(직전 대상)" 접미사가 붙은 객체를 저장해 라벨이 누적됨.
- 수정: ChatGPT.exe·Codex.exe → Codex(이미지 붙여넣기), Zed·Windsurf(경로), Slack·Discord(채팅). 모르는 앱이라도 실제 앱 창이면 "창: <제목> (<프로세스>)" 대상으로 쓰고, 직전 대상 폴백은 전경 창이 없음/바탕화면/작업표시줄/우리 창일 때만. 직전 대상은 원본을 저장하고 표시용 라벨에만 접미사 한 번.
- 대상 선택 메뉴: 편집기 대상 바 클릭 또는 Ctrl+T → 맨 위 "자동: …"(기본 선택), 그다음 알려진 에이전트·채팅 앱, 나머지 열린 창(최대 12). 고른 창은 이번 전송에만 적용. "이 창을 기본 대상으로 고정"을 켜면 `config.pinnedTargetProcess/Title`에 저장되어 자동 판별보다 우선(그 창이 없으면 자동 판별), 트레이 "기본 대상 고정 해제"로 해제.
- 단위 테스트 `tests/agents.test.ts`: ChatGPT.exe → codex, 모르는 앱 → 창 대상, 바탕화면/작업표시줄/빈 제목/우리 프로세스 → null, 후보 정렬·12개 상한, 고정 매칭.

### 19.8 검증 (2026-10-24)
- `npx tsc --noEmit` 0, `npm test` 48개 통과, `npm run build` OK
- 자가 테스트(음성 WAV 포함, 스크롤 제외 — 사용자가 작업 중이라 실제 마우스를 움직이지 않음) `ok:true`, 경고·오류 0. 스크린샷으로 텍스트 꾸미기·색 팝오버·대상 메뉴·B 표시 확인
- 설치판: `dist\win-unpacked\Backseat.exe --selftest --selftest-no-stt --selftest-no-scroll` ok, node_modules가 없는 폴더로 복사한 설치판 mcp-server.js로 mcp-check `MCP_OK`
- 사람이 확인할 것: 설치 파일 실행 후 시작 메뉴·바탕화면 아이콘, 재부팅 뒤 자동 시작, ChatGPT(Codex) 앱 앞에서 캡처 → 전송, Ctrl+T 대상 메뉴로 다른 창에 보내기·고정, 스포이트(EyeDropper)로 화면 밖 색 집기, 실제 AI가 screenshot.png/B 표시를 구분하는지
- 테스트용 한국어 WAV: Windows TTS(Heami) 기본 속도로 "이 로그인 버튼…"을 만들면 Whisper가 "1호구인"으로 들을 때가 있다 → Rate -2, "화면 위쪽에 있는 로그인 버튼이 너무 작아요. 로그인 버튼을 한 1.5배 키워 주세요."

## 20. 배포 준비: 라이선스·후원 (2026-10-24)
- 방침: 완전 무료 + MIT, 자발적 후원(Buy Me a Coffee 또는 Ko-fi, GitHub Sponsors). 실행 때마다 뜨는 후원 팝업은 만들지 않는다.
- `LICENSE`(MIT, wowls2162, 2026), `THIRD_PARTY_NOTICES.md`(Electron, transformers.js, onnxruntime, sharp, koffi, MCP SDK, zod, 내장 폰트 6종 OFL). 설치 프로그램은 `nsis.license`로 라이선스를 보여 주고, LICENSE.txt·THIRD_PARTY_NOTICES.md를 설치 폴더 resources에 넣는다.
- 링크·앱 이름은 `src/shared/links.ts` 한 곳(`REPO_URL`, `ISSUES_URL`, `SUPPORT_URL`, `KOFI_URL`). 트레이 "후원하기 ☕"·"정보…"와 정보 창이 여기서 읽는다. README의 배지·후원 링크는 같은 값을 직접 적어 두었으므로 링크를 바꿀 때 README의 `REPLACE_ME`도 함께 바꾼다.
- 정보 창(`src/main/about.ts`, `src/renderer/about/`): 420×360, 항상 하나. 버전·설명·GitHub/후원/문제 신고 버튼·라이선스 전문·서드파티 고지. 외부 열기는 main에서 http(s)만 허용. 자가 테스트가 창을 열어 버전·버튼 3개를 확인하고 `about.png`를 남긴다.
- 사람이 할 일: 후원 계정(Buy Me a Coffee/Ko-fi) 만들기 → `SUPPORT_URL`·README 링크 교체, GitHub 저장소 만들기 → `REPO_URL`·`ISSUES_URL`·README 교체.

## 21. 언어팩 1차 (2026-10-25, v0.4.0)
1차 언어 9개: ko(원본), en(대체 언어), ja, zh-CN, zh-TW, es, pt-BR, de, fr. 2차(vi, id, tr, pl, it, ru, uk, hi)와 RTL(ar, he)은 범위 밖.

### 구조
- `src/shared/i18n.ts`(의존성 없음): `Locale`·`LOCALES`·`LOCALE_NAMES`, `t(key, params)`(`{name}` 치환), 복수형은 필요한 키만 `<key>.one/.other`(CLDR, `t(key, { n })`), 누락 키는 en → ko 순서로 대체하고 개발 실행에서만 콘솔 경고(키당 1회), 렌더러용 `applyDom()`(`data-i18n`, `data-i18n-title`, `-placeholder`, `-aria-label`, `<html lang>`).
- 문구: `src/locales/<locale>.json`(평면 키 약 330개, 접두사 `tray. editor. timeline. colorpicker. palette. selector. about. brief. agents. send. mcp. requests. scroll. dialog. stt. app.`), `_context.json`(키마다 나오는 곳·길이 제한·자리표시자 뜻 — 번역자용), `GLOSSARY.md`.
- 메인: `src/shared/bundles.ts`가 9개 JSON을 import(import attributes라 Node 테스트도 읽음), `src/main/locales.ts`가 화면 언어·브리프 언어·음성 언어를 정한다. 렌더러는 파일을 읽지 않고 `EditorInit/SelectorInit/AboutInfo`의 `locale`·`messages`(대체까지 합친 묶음)를 받는다 — main이 보낼 때 채우므로 언어를 바꾸면 다음 캡처부터 적용. 렌더러 모듈 최상위는 init보다 먼저 돌므로 `t()`는 init 뒤에만(라벨은 함수로 지연).
- MCP 서버(plain Node)는 electron 없이 같은 bundles를 묶고, 호출마다 config.json의 `locale`·`briefLocale`을 읽는다('auto'면 `Intl`의 시스템 로캘).

### 언어 결정 규칙
- `config.locale`: 'auto'(기본) = `app.getLocale()`을 1차 언어로 매핑 — ko/en/ja/es/de/fr 그대로, zh-TW/zh-HK/zh-MO/zh-Hant → zh-TW, 그 밖의 zh → zh-CN, pt-*(pt-PT 포함) → pt-BR, 나머지 → en. 트레이 "언어 / Language"(자동 + 9개, 이름은 각 언어로)에서 바꾸면 트레이는 즉시 갱신.
- `config.briefLocale`: 'follow'(기본, 화면 언어) | 'en'(트레이 "브리프는 영어로"). brief.md·붙여넣는 지시문·이미지 붙여넣기 앞 표시·MCP 응답이 이 언어. brief.md 구조·섹션은 언어와 무관하게 같고, 언어 표시 줄은 없다.
- `config.sttLanguage`: 'auto'(기본, 화면 언어의 Whisper 언어명) | 'detect'(Whisper 자동 감지) | 'korean' 등. 편집기는 언어를 보내지 않고 main이 정한다. config v1의 'korean'(옛 기본값)은 v2에서 'auto'로 바뀐다.
- 지시어(`align.ts`): 8개 언어 목록(`DEICTIC_WORDS`), 기본 정규식은 전부 합친 것(말하는 언어가 화면 언어와 다를 수 있음). 띄어쓰기 언어는 유니코드 글자 경계(`\b`는 aquí·là를 못 다룸), ko/ja/zh는 경계 없이.
- 글꼴: Noto Sans JP/SC/TC 400/700을 `@fontsource`로 넣되 CSS를 동적 import(해당 글꼴을 쓸 때만 @font-face 추가). 텍스트 도구 기본 글꼴 ja → JP, zh-CN → SC, zh-TW → TC, 나머지 Noto Sans KR(라틴 확장 포함). 빌드 플러그인 `woff2Only`가 @fontsource CSS의 `.woff` 대체본을 빼서(Chromium은 woff2만 씀) 기존 한글 글꼴분 약 10 MB도 줄였다.
- 설치 파일 크기: 0.3.2 306,734,694 B → 0.4.0 243,300,948 B (−63.4 MB, −21%). 원인 둘: (1) `@fontsource/*`가 `dependencies`에 있어서 electron-builder가 날 글꼴 패키지(node_modules, 수천 개 파일)를 app.asar에 통째로 넣고 있었다 — 렌더러 번들(out/renderer)이 이미 필요한 woff2를 갖고 있으므로 `devDependencies`로 옮김(일본어·중국어를 dependencies로 넣었을 땐 535 MB까지 커졌음). (2) .woff 대체본 제거. 렌더러 번들 자체는 21 MB → 28 MB(CJK woff2 +약 22 MB, .woff −약 10 MB).
- 툴바: 820 px에서 넘치면 `#toolbar.tight`(버튼 여백·글자 조금 줄임)로 바뀐다. es/pt-BR/de/fr이 해당.

### 용어집 (요약, 전체는 `src/locales/GLOSSARY.md`)
| ko | en | ja | zh-CN | zh-TW | es | pt-BR | de | fr |
|---|---|---|---|---|---|---|---|---|
| 캡처 | capture | キャプチャ | 截图 | 擷取 | captura | captura | Screenshot / erfassen | capture |
| 주석 | annotation | 注釈 | 标注 | 標註 | anotación | anotação | Annotation | annotation |
| 브리프 | brief | ブリーフ | 简报 | brief | brief | brief | Briefing | brief |
| 세션 패키지 | session package | セッション | 会话 | 工作階段 | sesión | sessão | Sitzung | session |
| 전송 / 대상 | Send / target | 送信 / 送信先 | 发送 / 目标 | 傳送 / 目標 | Enviar / destino | Enviar / destino | Senden / Ziel | Envoyer / cible |
| 에이전트 | agent | エージェント | 智能体 | 代理 | agente | agente | Agent | agent |
| 메모 | note | メモ | 备注 | 備註 | nota | nota | Notiz | note |
| 녹음 / 녹화 | record / video | 録音 / 動画 | 录音 / 视频 | 錄音 / 影片 | grabar / video | gravar / vídeo | Aufnahme / Video | enregistrement vocal / vidéo |
| 고정 | pin | 固定 | 置顶·固定 | 釘選 | fijar | fixar | anheften | épingler |
| 전/후 비교 | before/after | 前後比較 | 前后对比 | 前後比較 | antes/después | antes/depois | Vergleich | avant/après |

### 검증
- `npm test` 61개(언어팩: 9개 파일이 en과 같은 키·같은 자리표시자·빈 문자열 없음·복수형 짝·_context 존재, 로캘 매핑, 대체 순서, 지시어 8개 언어).
- `npm run selftest -- --selftest-locale=all --selftest-shots=<dir>`: 언어마다 선택 화면·편집기(타임라인 포함)·정보 창 스크린샷, `<html lang>`, 화면에 원시 키가 보이지 않는지, 툴바 3줄·대상 바·비교 바가 820 px에서 넘치지 않는지, Noto Sans KR/JP/SC/TC가 실제로 로드됐는지, 그 언어의 brief.md 생성. 기본 자가 테스트는 한국어로 고정(한국어 문구 검사).

### 문구 정리 원칙 (외부 검토 반영, 2026-10-25)
"AI가 쓴 티가 난다"는 검토에 따라 ko 원문과 en을 다시 쓰고 다른 7개 언어는 바뀐 키만 다시 번역했다. 괄호 속 부연 설명, 타사 제품명 나열("Snagit·Canva…"), 같은 말 반복, 개발 용어("전사", "스크럽", "API", 파일 이름)를 화면 문구에서 덜어낸다. 툴팁은 하는 일을 한 문장으로("글자 둘레에 테두리를 넣습니다."), 상태 메시지는 일어난 일 + " · 단축키로 …"(괄호 대신 가운뎃점). 사용자 문서(README, 정보 창)는 "~하세요 / ~할 수 있습니다" 존댓말로 통일. 앱 소개는 AI가 알아서 작업을 시작하는 것처럼 들리지 않게("화면에 표시하고 말로 설명한 내용을 AI에게 전달합니다."). 오해를 부르는 이름은 바꾼다: 타임라인의 "녹화"(녹화 시작으로 읽힘) → "영상 저장", 비교 모드 "와이프" → "좌우 비교". 브리프·MCP처럼 에이전트가 읽는 문구는 이 원칙 밖(정확성 우선). README는 첫 사용 흐름(설치 → 캡처 → 표시하고 설명 → 보내기)을 맨 앞에, 상세 기능 표는 아래에, 개발 세부사항은 `docs/DEVELOPMENT.md`로.

### 2차 언어 추가 방법
1. `src/shared/i18n.ts`의 `LOCALES`·`LOCALE_NAMES`에 코드 추가, `matchSystemLocale`에 매핑(예: 'vi'), `src/shared/bundles.ts`에 import.
2. `src/locales/<code>.json`: `en.json` + `_context.json` + `GLOSSARY.md`를 주고 번역(버튼은 영어 길이 이내). `npm test`가 키·자리표시자를 검사.
3. `src/main/locales.ts`의 `WHISPER_LANG`(그리고 필요하면 `STT_LANGUAGES`, `stt.lang.*` 키), `align.ts`의 `DEICTIC_WORDS`.
4. 글리프: 내장 글꼴에 없는 문자(예: 힌디 데바나가리)는 `@fontsource/noto-sans-<script>`를 `LAZY_FONT_CSS`·`LOCALE_FONT`에 추가.
5. RTL(ar, he)은 따로: `<html dir="rtl">`, 툴바·대상 메뉴·타임라인 배치 반전, 브리프 좌표 설명 검토가 필요하다.
6. `--selftest-locale=<code>`로 스크린샷·넘침 확인.


## 22. Codex 리뷰 반영 (2026-10-25)

Codex가 930b9b4(v0.3.2) 기준으로 낸 리뷰 15건(F01–F15)을 v0.4.0(언어팩 머지 뒤) 위에서 검증했다. 각 지적마다 **수정 전 코드에서 실패하는 테스트**를 먼저 만들고 확인한 뒤 고쳤다. 15건 모두 재현되어 기각한 것은 없다.

### 테스트 기반
- `npm test`가 Electron 없이 main 프로세스 모듈도 돌린다: `tests/support/fake-electron.ts`(가짜 `electron`), `register.mjs`/`ts-resolve.mjs`(확장자 없는 import 해석), Node `--experimental-test-module-mocks`로 `fs/promises`·`worker_threads`·`win32`·`send` 등을 바꿔 끼운다. 각 테스트 파일은 따로 프로세스에서 돈다.
- 편집기(렌더러)처럼 DOM이 필요한 부분은 순수 모듈(`doc.ts`, `sendflow.ts`)로 떼어 단위 테스트하고, 실제 연결은 자가 테스트가 확인한다.

### 지적별 결과
| ID | 결과 | 원인 → 수정 | 확인 |
|---|---|---|---|
| F01 높음 | 수정 | 블러를 시간 따라 그리는 주석으로 취급 → 영상 첫 프레임부터 원본 노출. 모든 영상 프레임이 `maskedBase()`(원본+모든 블러, screenshot.png와 같은 바탕) 위에 그려지고 블러는 시간 주석에서 제외 | 자가 테스트 `video-mask`: 가장 복잡한 64px 영역에 임시 블러를 두고 시작/블러 전/중/끝 프레임과 **실제 인코딩한 WebM을 다시 디코딩한 프레임**을 원본·마스킹본과 비교. 수정 전 시작 프레임 {마스킹본과 40.4, 원본과 0}, 수정 후 모든 프레임 마스킹본과 0, 디코딩 프레임 최악 0.8(원본과 42) |
| F09 높음 | 수정 | 고른 창이 닫히면 자동 대상으로 조용히 전송 → `resolveSendTarget()`이 `targetExpired`를 돌려주고 아무것도 쓰지도 보내지도 않음. 편집기는 그 창을 메뉴에서 빼고 다시 고를 때까지 전송을 막음. 메뉴 끝에 "클립보드에만 복사" | `tests/editor-send.test.ts`(실제 IPC, 수정 전 자동 대상 A로 전송), 자가 테스트 `target-expired`(가짜 hwnd 선택 → 전송 → 상태·메뉴 재표시·5행) |
| F02 높음 | 수정 | 초 단위 ID + `mkdir recursive` → 같은 초 두 전송이 한 폴더. ID = 시각+밀리초+무작위(`20261025-143012-123-9f3a`), 준비 폴더는 배타적 생성, 충돌 시 새 ID | `tests/sessions.test.ts`(시계 고정 2회·동시 5회) |
| F04 중간 | 수정 | 파일을 제자리에 병렬로 쓰고 reader는 meta+brief만 보고 완성으로 판단 → `.writing-<id>`에 다 쓴 뒤 폴더 rename 한 번으로 게시(Windows EPERM 재시도), 실패하면 준비 폴더 삭제. MCP wait 검사 중복 실행·처리 안 된 rejection 제거 | `tests/sessions.test.ts`(annotated.png 쓰기 지연 중 미게시, 쓰기 실패 시 흔적 없음) |
| F06 중간 | 수정 | registry.json을 여러 MCP 프로세스가 읽고-고치고-씀(임시 파일 이름도 공유) → 프로세스마다 `agents/<pid>.json`, 옛 registry.json은 읽기만. 종료 시 동기 삭제(비동기는 exit에서 안 돌았음) | `tests/registry.test.ts`(동시 등록 2개·반복 등록/정리, 수정 전 rename ENOENT) |
| F03 높음 | 수정 | 마지막 등록 에이전트를 앞의 창에 무조건 결합 → 에이전트의 backseat-mcp 프로세스가 그 창 프로세스 안에서 돈다는 근거(프로세스 트리, 콘솔 호스트는 부모)가 있을 때만 결합. explorer.exe 등은 근거가 안 됨, 한 창에 여럿이면 제목의 프로젝트 폴더 이름으로만 구분. meta.json에 `recipient`, MCP latest/list/wait는 다른 에이전트 앞 패키지를 건너뜀 | `tests/agents-mcp.test.ts`(옛 규칙을 그대로 옮긴 코드에서 6개 중 4개 실패), `tests/win32.test.ts`, mcp-check의 수신자 검사 |
| F07 중간 | 수정 | 알림으로 답한 질문이 pending에 남아 다음 캡처에 붙음 → `requestForCapture()`가 클릭이든 pending이든 ID로 소비. 정책: 캡처를 시작하면 소비, 편집기를 취소하면 에이전트의 ask는 시간 초과(다시 물으면 됨) | `tests/requests.test.ts`(실제 watcher + 가짜 알림 클릭) |
| F08 중간 | 수정 | writer·markAnswered는 기본 경로, watcher·MCP는 설정 경로 → `config.ts sessionsRoot()` 하나를 모두가 사용(MCP는 같은 config 키를 읽음) | `tests/sessions.test.ts` F08 |
| F05 중간 | 수정 | 고정 창이 붙여넣기 뒤 숨은 채로 남고 busy 유지 → 사용자 결정(2026-10-25)에 따라 전송 뒤 편집기는 고정 여부와 상관없이 열어 둔다: 붙여넣은 뒤 포커스를 뺏지 않고 다시 표시, 자동 닫기와 busy 유지 제거(재전송·대상 변경·직접 복사 가능). 상태 표시 UI는 5단계 | `tests/send.test.ts`, `tests/sendflow.test.ts` |
| F10 중간 | 수정 | undo 이력에 링크는 있지만 어느 녹음의 링크인지 없음 → `Doc.linksRev`, 현재 녹음 것만 표시(`doc.ts linksAt`) | `tests/doc-links.test.ts`(실제 History), 자가 테스트 `recording-replace` |
| F11 중간 | 수정 | worker exit·stopStt가 대기 작업을 끝내지 않음, 새 worker 오류가 옛 작업을 끝냄 → 작업이 자기 worker를 기억, error/exit/terminate에서 한 번만 실패 처리 | `tests/stt-worker.test.ts`(가짜 Worker) |
| F12 중간 | 수정 | 음성 인식 실패에도 전송 성공 표시 → 전송 전에 "다시 시도 / 이미지만 보내기 / 취소"(Enter=다시 시도, Esc=취소). 이미지만 보내도 음성 파일은 패키지에 남음 | `tests/sendflow.test.ts`, 자가 테스트 `stt-failure`(대상을 클립보드로 바꾼 뒤 전송 → 질문 → 다시 시도 실패 → 질문 → 취소) |
| F13 중간 | 수정 | 디스크 쓰기 전에 캐시 갱신, 연속 저장 순서 뒤바뀜, 실패 무시 → 저장 직렬화, 임시 파일→rename 성공 뒤에만 캐시, 실패는 트레이 풍선으로 알림 | `tests/config.test.ts`(ENOSPC·느린 첫 쓰기) |
| F14 중간 | 수정 | mcp-check가 출력만 하고 항상 MCP_OK → 자체 패키지를 만들어 도구 목록·등록·이미지 MIME과 바이트·includeOriginal·list/get·wait 시간 초과와 수신자 건너뛰기·ask requestId를 검사, 하나라도 어기면 exit 1 | `tests/mcp-check.test.ts` + `tests/fixtures/wrong-mcp-server.mjs`(옛 검사기는 통과시킴, 새 검사기는 12건 실패), 실제 서버 `npm run mcp-check` MCP_OK |
| F15 낮음 | 수정 | 분을 먼저 내리고 초만 반올림 → `00:60.0`. 0.1초 정수로 반올림한 뒤 분·초 분리, brief도 같은 `fmtClock` | `tests/clock.test.ts`(59949/59950/59999/60000 + seed 0xBACC5EA7 2000개) |

### 0단계 긴급 안전 수정 (실제 사고)
- 관찰: 사용자 세션 기록(meta.json)에서 10/24 21:01·23:15·23:16 전송은 캡처하던 Chrome의 Buy Me a Coffee 가입·결제 설정 페이지를, 20:45 전송은 카카오톡 창을 대상(`unknown`, `paste-image`)으로 잡고 Ctrl+V를 보냈다. 원인은 §19.7에서 넣은 "모르는 앱도 실제 창이면 그 창으로 보낸다" 규칙: 웹페이지를 캡처하면 캡처 직전 앞 창이 그 페이지다.
- 수정: `isAutoTarget()` — 자동으로 붙여넣는 곳은 알려진 AI 도구(터미널·편집기 에이전트, Claude 앱, ChatGPT·Codex 앱, Cursor, VS Code·Windsurf·Zed, 브라우저의 Claude·ChatGPT·Gemini·Copilot 탭)뿐. 모르는 창과 메신저(카카오톡·Slack·Discord·Teams·Telegram·LINE …; Slack·Discord 자동 인식 규칙 삭제)는 대상 메뉴에서 고르거나 고정했을 때만. `detectTarget()` — 고정 창 → 앞 창(허용될 때만, 아니면 대상 없음: 패키지 저장 + 클립보드 + "보낼 곳을 선택하세요") → 직전 대상(앞에 진짜 창이 없을 때만, 그것도 자동 허용 대상일 때만). 대상 메뉴에는 모든 창이 그대로 나온다.
- 확인: 수정 전 코드에서 가입 페이지·카카오톡·Slack이 `paste-image` 대상이 되는 것을 확인. `tests/agents-safety.test.ts`(가입·결제 페이지, 메신저 6종 → 대상 없음, ChatGPT.exe → codex, 브라우저 ChatGPT 탭 → chat, 모르는 창 앞에서는 직전 대상으로도 안 감, 고정·명시 선택한 모르는 창은 그 창).
- 사용자가 확인할 것: 그 카카오톡 대화방과 Buy Me a Coffee 가입·결제 화면의 입력칸에 지시문이나 이미지가 남거나 보내지지 않았는지.

### 그 밖에
- CI: `.github/workflows/ci.yml`(windows-latest, Node 24: npm ci → typecheck → test → build → mcp-check). 자가 테스트는 데스크톱 세션이 필요해 CI에서 돌리지 않는다. 아직 push하지 않았다.
- 새 문구 15개와 0단계에서 바꾼 4개는 §21 문구 원칙대로 ko/en을 쓰고 나머지 7개 언어를 번역했다. 버전 0.4.2(0.4.1 설치판은 0단계 전 빌드라 쓰지 않는다).
- 작업 중 사고: 언어팩 세션과 같은 폴더(HEAD 하나)를 써서 첫 세 커밋이 fix 브랜치가 아니라 로컬 main에 올라갔다. 이후 작업은 별도 worktree(`D:\backseat-codex`, node_modules는 접합)에서 했다. 같은 폴더에서 여러 세션이 브랜치를 바꾸지 않는다. 실제 화면을 움직이는 자가 테스트는 D 드라이브의 backseat-ui-test.lock 파일이 없을 때만 그 파일을 만들고 돌린 뒤 지운다.

### 검증하지 못한 것
- 실제 OS에서 다른 창에 붙여넣기가 성공하는지(F05·F09는 창 숨김/표시와 전송 대상까지), 실제 ONNX 충돌(F11은 가짜 Worker), 실제 디스크 가득 참(F13은 쓰기 함수 대체), 여러 AI 앱을 동시에 띄운 실제 MCP 결합(F03은 프로세스 트리 모형 + 이 PC의 실제 스냅샷), 개발 환경 없는 PC에서 설치판 설치.

## 23. 보낼 곳·전달 검증 (2026-10-25, 2단계)

계획서 `docs/plans/2026-10-25-target-delivery-editor-plan.md` 3절 2·3·4단계의 메인 프로세스 부분. 요청서 (1)의 1~4, (2)의 ①②. 편집기 화면(칩·상태 표시)은 5단계(§24).

### 보낼 곳 모델 (`targets.ts`, `tracker.ts`, `destination.ts`)
- 보낼 곳을 캡처와 분리했다. 결정 순서: 사용자가 고른 창(편집기 메뉴·트레이 "보낼 곳", 그 창이 살아 있는 동안 다음 캡처에도 유지) → 고정 대상(config) → MCP 에이전트가 그 안에서 도는 것이 프로세스 트리로 확인된 창(여럿이면 최근 쓴 것) → **최근에 쓰던 AI 창**(400ms마다 앞 창을 보고 알려진 AI 창만 기억, 우리 창·바탕화면·작업표시줄 제외) → 캡처 직전 앞 창이 알려진 AI 앱 → 없음.
- 캡처한 페이지·메신저·모르는 창은 자동으로 고르지 않는다. AI 회사의 결제·로그인·설정 탭(제목 기준, 9개 언어 단어)도 자동 대상이 아니다.
- 고른 창이나 고정 창이 닫혔으면 다른 창으로 바꾸지 않고 `none` + `unavailable`(무엇이 없는지)로 다시 고르게 한다.
- 동일성 `TargetIdentity` = 창 핸들 + PID + 프로세스 시작 시각 + 제목. 핸들 재사용·프로세스 재시작은 다른 창이다. 제목은 브라우저 탭·직접 고른 창에서만 비교한다. 터미널·편집기·AI 앱은 제목이 수시로 바뀌기 때문이다.
- 편집기에는 `EditorInit.sendTarget`(SendTargetView), `editor.targets()`(현재 대상 + 후보, 모두 identity 포함)를 준다. 트레이에 "보낼 곳" 하위 메뉴: 지금 대상, 자동, AI 창 목록, 다른 창, 기본 대상으로 고정·해제.

### 붙여넣기 직전 검증 (`send.ts`, `delivery.ts`, `native/uia*.ts`)
- 단계: 자료 저장 → 클립보드 → 대상 확인(같은 창 인스턴스, 앞으로 가져온 뒤 다시 확인) → 입력란 확인 → Ctrl+V 직전 재확인 후 붙여넣기 시도. 확인한 단계만 `DeliveryStatus.reached`에 넣고, 멈추면 `stoppedAt{step, reason}`를 남긴다. 클립보드는 준비된 채로 둔다.
- 입력란 확인: UIA 포커스 요소가 ① 비밀번호 칸이 아님(가장 먼저 확인, 값을 알 수 없으면 비밀번호로 간주) ② 대상과 같은 프로세스 ③ 편집 가능(Edit/Document, Value 쓰기 가능)이어야 한다. 터미널 대상은 TermControl(Windows Terminal), 레거시 콘솔은 그 콘솔 호스트(conhost)의 Document를 인정한다.
- Claude 앱·Codex·ChatGPT 앱은 쓸 수 있는 입력란이 정확히 하나이고 비밀번호 칸이 없을 때만 UIA SetFocus를 쓴다. 좌표 클릭·Tab 반복은 없다.
- Ctrl+V는 UIA 작업 스레드 안에서 `CompareElements`로 같은 요소인지, 앞 창이 그대로인지, 비밀번호 칸이 아닌지 다시 확인한 직후에 보낸다. 늦게 깨어난 스레드는 키를 누르지 않는다(기한 전달). 전송은 한 번에 하나씩 한다.
- 자동 Enter: 대상·입력란·붙여넣기가 모두 확인됐을 때만 누른다. 알려진 AI 종류이고, 창이 여전히 같은 종류로 보일 때만이다. 그냥 셸, 직접 고른 메신저·페이지, "그래도 이 창에" 확인 전송에는 누르지 않는다. Enter 직전에도 같은 요소인지 확인한다. 누르면 `enterPressed`.
- 제목이 바뀐 탭(`targetChanged`)은 한 번 묻는다. 멈춘 바로 다음 전송이 그 창으로 가면 확인으로 보고, 멈출 때 보였던 그 제목일 때만 붙여넣는다.
- 편집기는 숨기지 않는다. 대상이 위로 올라오고, 멈추면 편집기를 다시 앞으로 가져온다.
- 창 활성화: 예전의 "Alt 한 번 누르기"는 Alt 뗌이 Chrome·Edge에 도착해 ⋮ 메뉴 버튼에 포커스를 줬다. 그러면 Ctrl+V가 입력란이 아니라 메뉴로 갔다. v0.4.x까지 있던 문제로, 사고 보고의 "어디에도 전달되지 않음"과 맞을 수 있다(확인은 못 함). 이제 키를 누르지 않는다. 편집기가 앞이면 바로 넘기고, 아니면 `AttachThreadInput`을 쓴다.
- Chromium은 처음 질의에 창 Pane만 돌려준다(접근성 트리가 아직 꺼져 있음). 200ms 간격으로 다시 묻는다.
- 문구: 붙여넣으면 "붙여넣기를 시도했어요 · 제출은 직접 해주세요". 멈춘 이유별 안내(비밀번호 칸·입력란 없음·창 닫힘·내용 바뀜·포커스 이동·확인 불가) 9개 언어.

### MCP 수신 확인 (`mcp/receipts.ts`, `fetchwatch.ts`)
- MCP로 확인된 대상에 붙여넣는 지시문은 `backseat_get`에 전송 ID를 넣게 한다.
- backseat-mcp는 패키지를 돌려줄 때(get·latest·wait·ask) `<sessions>/receipts/<id>/<agent>-<ms>-<rand>.json`을 원자적으로 쓴다. 내용은 전송 ID, 등록 에이전트 ID·이름·cwd, 도구, 시각이다.
- 앱은 마지막 전송의 수신 기록을 보고 `delivery:update`로 `fetchedBy`를 준다. 정해진 수신 에이전트면 `expected: true`이고 reached에 `fetched`가 들어간다. 다른 에이전트면 `expected: false`로만 표시한다. MCP 대상인데 3분 안에 없으면 `fetchTimedOut`.
- "가져갔다"만 말하고 이해·완료로 읽힐 문구는 쓰지 않는다.

### 진단 로그 (`diaglog.ts`)
- `<userData>\logs\delivery.log`(512KB에서 교체)에 단계·판정만 남긴다. 판정은 요소 종류, 비밀번호 칸 여부, 같은 프로세스 여부, 이유 코드다.
- 창 제목, 클립보드, 메모, 요소 이름·값, 웹페이지의 HTML class(Chromium의 UIA ClassName)는 남기지 않는다.

### 계약 추가(선택 필드, 상위·5단계 세션에 알림)
`SendTargetView.unavailable`, `SendOptions.confirmTarget`, `DeliveryStatus.enterPressed`, `editor.newCapture()`(5단계 요청: 편집기를 닫고 영역 캡처).

### UIA 방식 (실측: `docs/plans/uia-spike.md`)
koffi로 UIAutomationCore COM을 작업 스레드(COM MTA)에서 직접 부른다. 시작 약 5ms, 반복 질의 1.6~3.8ms. 추가 exe·PowerShell이 없고 네이티브 UIA라 정보가 정확하다. 상주 PowerShell(시작 178~507ms, 회사 PC 정책 위험)과 csc 빌드 exe(서명 없는 추가 파일, 관리형 UIA라 Value 패턴을 놓침)는 고르지 않았다.

### 검증
- `npm test` 153개. 대상 결정 순서, 동일성, 입력란 판정표(비밀번호·읽기 전용·다른 프로세스·포커스 없음·콘솔), 단계 상태, Enter 규칙, 로그에 비밀 없음, 수신 기록(정확한 ID·에이전트만), "한 번 묻기"를 확인한다.
- `npm run mcp-check` MCP_OK(수신 기록 검사 추가). `npm run selftest -- --selftest-no-scroll` ok(오류·경고 0). `npm run typecheck` 통과.
- `npm run selftest-delivery`(새로 추가): 가짜 채팅 창 2개와 가짜 로그인 페이지를 별도 Chrome 프로필로 띄우고, 실제 편집기 IPC·UIA·Ctrl+V로 요청서 (1)의 6개 상황을 돌린다. 자기 시험 창만 보고(고정·MCP·실제 창 제외), 패키지는 임시 폴더에 쓴다. 최종 실행 9/9 통과:

| 상황 | 대상(source) | 확인된 단계 → 멈춤 | 판정 |
|---|---|---|---|
| 1 AI 입력란 클릭 → 로그인 페이지(아이디 칸 커서) 캡처 → 보내기 | recent-agent(가짜 채팅 A) | 저장→클립보드→대상→입력란→붙여넣기 시도 | A에 들어감, 로그인 칸 0/0 |
| 2a 로그인 페이지가 앞, 아무것도 안 고름 | none | 저장→클립보드 · noTarget | 어디에도 안 붙임 |
| 2b 로그인 페이지를 직접 고름, 비밀번호 칸 포커스 | picked | 저장→클립보드→대상 · passwordField | 비밀번호 칸 0 |
| 3 AI 창은 열렸지만 입력란에 포커스 없음 | recent-agent | 저장→클립보드→대상 · notEditable | A 비어 있음 |
| 4a 같은 앱 창 2개, 최근은 B인데 A를 고름 | picked | …→붙여넣기 시도 | A에만 들어감, B 비어 있음 |
| 4b 같은 창이 다른 페이지(제목 변경) | recent-agent | 저장→클립보드 · targetChanged, 다시 보내기 → 붙여넣기 시도 | 바뀐 것을 확인한 뒤에만 |
| 5a 편집 중 대상 창 닫힘 | recent-agent | 저장→클립보드 · targetExpired | 다른 창 안 씀, 패키지 보존 |
| 5b 활성화 직후 포커스가 다른 요소로 이동 | recent-agent | 저장→클립보드→대상 · notEditable | 아무 데도 안 붙임, Enter 없음 |
| 6 실패 뒤 같은 내용으로 다시 보내기 | picked | …→붙여넣기 시도 | 두 패키지의 주석 동일 |

- 실제 앱(사용자 허락, Enter 없음, 새 창·새 대화만, 확인 후 비움, 비밀번호 칸 없음, 붙여넣은 것은 1×1 빈 이미지와 시험 지시문):

| 앱 | 포커스 요소(UIA) | 결과 |
|---|---|---|
| Windows Terminal(cmd 탭) | TermControl, 같은 프로세스 | 붙여넣기 시도 ✓, 프롬프트에 한 줄 들어감, 창 닫아 버림 |
| Windows Terminal + Claude Code | TermControl → 터미널 판정은 통과 | 이 PC에서 Claude Code CLI 첫 실행이라 초기 설정(테마 선택) 화면이 떠서, Enter 없이는 진행할 수 없어 붙여넣지 않음 |
| 레거시 콘솔(conhost·cmd) | conhost의 Document | 붙여넣기 시도 ✓, 창 닫음 |
| Codex·ChatGPT 앱(ChatGPT.exe), "새 채팅"을 UIA로 열어 | Edit(ProseMirror), 쓰기 가능 | 붙여넣기 시도 ✓, 텍스트만 들어감(이미지는 안 붙음), 비운 뒤 원래 대화로 되돌림 |
| 브라우저 ChatGPT 탭(사용자 Chrome, 새 탭) | Edit(ProseMirror), 쓰기 가능 | 붙여넣기 시도 ✓, 비우고 탭 닫음 |
| Claude 앱 | Edit(tiptap ProseMirror), 쓰기 가능 | 입력란 판정만 확인. 이 작업 세션이 그 앱 안에서 돌고 있고 좌표 클릭 없이 새 대화를 여는 방법을 확인하지 못해 붙여넣지 않음 |

### 남은 한계
- 터미널 안쪽은 UIA로 보이지 않는다. Claude Code가 설정 화면·선택 질문을 띄우고 있어도 "터미널 입력"으로 판정된다.
- 같은 창 안의 탭·대화: 브라우저 탭은 제목으로 구별한다. 탭 제목에 Claude·ChatGPT·Gemini·Copilot이 없으면(대화 이름만 제목인 경우 등) 자동 대상이 아니다. 이때는 직접 고르면 된다. 새 대화 탭의 제목 "ChatGPT - Chrome"은 확인했다. AI 앱은 창 안의 대화를 구별하지 못한다.
- "입력란이 하나일 때만 SetFocus"는 실제 앱(Codex 3개·Claude 2개 Edit)에서는 거의 동작하지 않는다. 대부분 "입력란을 클릭한 뒤 Ctrl+V"로 멈춘다(안전 측).
- 수신 확인은 MCP로 연결된 에이전트가 도구를 실제로 호출할 때만 생긴다. 일반 붙여넣기는 "시도"까지만 확인한다.
- 진단 로그는 사용자 설정 폴더(`%APPDATA%\backseat\logs`)에 쌓인다. 자가 테스트 로그도 같은 곳이다.
- 화면 잠금 파일 `D:\backseat-ui-test.lock`은 Claude 도구의 안전 검사(드라이브 루트 경로) 때문에 세션이 지울 수 없다. 사용자가 직접 지워야 한다. 다음부터는 잠금 위치를 루트가 아닌 폴더로 바꾸는 것을 권한다.
- 검증하지 못한 것: 실제 MCP 에이전트의 수신 확인 왕복(mcp-check와 단위 테스트로만), Cursor·VS Code 안 에이전트, 여러 모니터·DPI 혼합, 설치판.

## 24. 편집 화면 정리 (2026-10-25, 요청서 3 + 요청서 2의 표시 부분)

계획서 `docs/plans/2026-10-25-target-delivery-editor-plan.md` 5단계. 2단계(§23, 보낼 곳·붙여넣기 직전 검증)의 계약(`SendTargetView`, `DeliveryStatus`, `PreflightReport`) 위에서 편집기 화면만 바꿨다. 주석·음성 연결·저장·전송 데이터 구조, 단축키, 자가 테스트가 쓰는 요소 id는 그대로다.

### 바뀐 화면
- **1줄 = 표시 → 말하기 → 보내기**: [화살표][번호][펜][가리기] · [텍스트][사각형] · [⋯] · [↶][↷] · [🎤 녹음] ··· [보낼 곳 칩 ▾][보내기]. 고른 도구는 빨간 테두리+채운 배경. 창이 좁거나 언어가 길면 먼저 버튼 간격을 줄이고, 그래도 넘치면 사각형 → 텍스트 → (녹음 글자) → (칩 둘째 줄) → 가리기 → 번호 → 펜 순서로 ⋯에 들어간다(480 px 고정 창에서도 1줄). 칩 글자가 잘리면 간격 줄이기와 사각형까지만 양보한다.
- **2줄 = 고른 도구의 옵션만**: 펜·화살표·사각형 색·굵기 / 번호 색·크기(작게·보통·크게)·다음 번호 / 가리기 강도(보통·강하게·완전히=한 색으로 덮음) / 텍스트 색·글꼴·크기·굵게·기울임·글자 효과·[세부 ▸] / 자르기 [적용][취소](드래그 후 Enter·Esc도 됨, 적용하면 원래 도구로 돌아감) / 지우개 안내. 텍스트 [세부]를 누르면 3줄째(배경색·자동·불투명도·반전·윤곽선·그림자·[닫기])가 열리고, 다른 도구를 고르면 접힌다.
- **⋯ 메뉴**: 자르기·지우개, 타임라인·전/후 비교·창을 항상 위에, 복사·저장·영상 저장(단축키 표시). 비교 막대는 비교를 켰을 때만 보인다. 녹음 중 표시·정지는 1줄의 녹음 버튼에 그대로.
- **보낼 곳 칩**: 첫 줄 = 어디로(예: "Claude Code · backseat"), 둘째 줄 = 얼마나 확실한지(연결 확인됨 / 선택함 / 고정 / 추정 · 최근 사용 / 추정). 대상 없음은 점선 "보낼 곳을 선택하세요"(보내기는 저장+클립보드), 고른·고정한 창이 없으면 "OO · 열려 있지 않음"(보내기 전에 다시 고름). ▾ 또는 Ctrl+T = 대상 메뉴(열 때마다 main에서 지금 열린 창 목록을 받음, 닫힌 것으로 확인된 창은 다시 내놓지 않음).
- **아래 보낼 내용 줄(같은 자리에서 전달 상태로 바뀜)**: 보내기 전 "보낼 내용 이미지 1장 · 주석 3개 · 메모 · 음성 설명 준비됨"(+ 전사가 끝나면 [음성 연결 확인] → 타임라인). 전사 실패면 "음성 설명이 빠졌어요 [다시 변환] [음성 없이 보내기]"이고 보내기는 아무것도 보내지 않는다(모달 질문 대신, F12 유지). 정상이면 확인창 없이 바로 보낸다. 보낸 뒤에는 main이 확인한 단계만 ✓(저장됨·클립보드 준비·대상 확인·입력란 확인·붙여넣기 시도·AI가 가져감), 멈춘 단계는 ✕와 이유·할 일, [다시 보내기][보낼 곳 바꾸기][직접 복사][새 캡처][닫기]. 문구: "붙여넣기를 시도했어요 · 제출은 직접 해주세요", "붙여넣기와 Enter를 시도했어요", "AI가 자료를 가져갔어요 · OO", "수신 미확인", 제목이 바뀐 창은 "이 창에 보내기"(confirmTarget). 이해·완료로 읽히는 말은 쓰지 않는다(단위 테스트가 ko/en 문구를 검사). 보낸 뒤 고치면 요약으로 돌아가며 "보낸 뒤 바뀜"이 붙는다. 편집기는 보낸 뒤에도 열려 있다.
- **기본값과 기억**: 색 #E5484D, 굵기 4, 글자 24 px 배경 상자, 번호 보통(22), 가리기 보통. 도구마다 마지막 옵션(색·굵기·크기·강도·글자 효과 전부)과 마지막 그리기 도구를 `localStorage['backseat.tools']`에 기억(자르기·지우개는 시작 도구로 기억하지 않음). 저장소가 막혀도 기본값으로 동작. 0.4.x의 `backseat.color`(펜 색 하나)는 처음 한 번 모든 도구 색으로 옮긴다. 자가 테스트는 `backseat.selftest.tools`만 쓴다.

### 구조
- `src/renderer/editor/prefs.ts`(기억·검증, 필드마다 따로 기본값으로), `delivery.ts`(요약 문자열, 칩 표시, `DeliveryStatus` → 단계·문구·첫 행동, 옛 `SendResult` 해석, `delivery:update` 병합) — DOM 없는 순수 모듈.
- 옛 main(2단계 전)에서도 돌도록 `sendTarget`이 없으면 `target`/`targetPinned`에서, `status`가 없으면 `SendResult`에서 확인한 만큼만 단계로 바꾼다(입력란 확인은 절대 추정하지 않음).
- 디버그 훅 추가: `resetPrefs`, `prefs`, `fit`, `sendbar`, `fakeDelivery`, `deliveryUpdate`, `fakeTarget`, `fakeRecording`.

### 검증
- `npm test` 168(편집기 몫: `tests/prefs.test.ts` 9, `tests/editor-delivery.test.ts` 13 — 모든 `DeliveryStep`·`DeliveryStopReason`, 과장 문구 없음, 옛 결과 해석), typecheck.
- 자가 테스트: 기본(`--selftest-no-scroll --selftest-no-stt`) 통과 — 자르기는 적용 버튼, 비교 막대, 세부, 칩 상태, 전사 실패 인라인, 480 px 1줄 확인 포함. `--selftest-locale=ko,en,ja,de` 통과(820 px에서 1·2·3줄과 비교 막대가 넘치지 않음, 전달 상태 화면).
- `--selftest-flows`(새): 요청서 (3)의 4개 흐름을 실제 편집기에서 실제 입력 이벤트로 — ① 화살표·번호·가리기 세 군데 → 보내기 → 단계 표시 → "가져갔어요" ② 실제 마이크 녹음 중 화살표 → 정지 → 전사(대체) → 음성 연결 확인 → 보내기(전사·음성 포함 확인) ③ 텍스트 입력 → 세부 열고 반전·그림자 → 닫고 화살표로 복귀 → 새 편집기에서 마지막 도구·굵기·그림자 기억 확인 ④ 가리기 → Ctrl+Z → Ctrl+Shift+Z → 버튼 되돌리기·다시 실행. 그 밖에 비밀번호 칸·대상 없음·제목 바뀜(이 창에 보내기 → confirmTarget)·열려 있지 않은 칩·대상 메뉴·⋯ 메뉴·820/480 px, ko/en/ja/de. 화면은 오프스크린으로 그린 가짜 앱이고 main의 send/transcribe/targets는 가짜 응답이라 실제 붙여넣기·세션 저장·음성 인식은 하지 않는다.
- 스크린샷: `docs/plans/editor-ui-shots/before/`(이전 화면), `after/`(flow1~4, stop-*, chip-unavailable, target-menu, more-menu, width-820/480, lang-ko/en/ja/de(+delivery)). 로캘 자가 테스트가 실제 화면 일부를 찍으므로 그 결과는 docs에 두지 않는다.

### 남은 한계
- 편집기 UI에서 실제 창으로 붙여넣는 경로는 이 작업에서 돌리지 않았다(흐름 테스트는 main 응답을 대체). main 쪽 실제 검증은 §23 `--selftest-delivery`.
- 음성 인식은 흐름 테스트에서 대체 응답(실제 녹음은 함). 스크롤 캡처 자가 테스트는 사람이 쓰는 PC라 건너뜀(편집기 변경과 무관).
- es·pt-BR·fr·zh-CN·zh-TW는 문구만 번역했고 화면 넘침은 직접 보지 않았다(자동 접기가 있음). 번역 중 사람 검토가 필요한 선택: 칩 "연결 확인됨"을 en "connected"로, `editor.step.clipboard`를 일부 언어에서 "복사됨"으로.
- 칩 이름이 길면 말줄임(전체는 툴팁). 보낸 뒤 상태 줄은 좁은 창에서 2~3줄로 접힌다.
- 고정(📌) 창은 main이 480 px로 줄이지만 편집기 창 `minWidth: 820` 때문에 실제로 줄어드는지 확인하지 않았다(자가 테스트는 최소 크기를 풀고 480 px를 확인).
