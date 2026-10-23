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

## 12. 다음 액션 (M1)
- [ ] 창 캡처 모드: 마우스 아래 창 하이라이트 (Win32 EnumWindows + DWMWA_EXTENDED_FRAME_BOUNDS, koffi)
- [ ] 화살표·사각형·번호 뱃지·블러·자르기 도구
- [ ] strokes.json + meta.json을 포함한 세션 패키지 저장 (`.backseat/sessions/<id>/`)
- [ ] 활성 에이전트 판별(포커스 창) + 터미널 자동입력 전송
- [ ] 전체/모니터 캡처 모드 선택 UI
