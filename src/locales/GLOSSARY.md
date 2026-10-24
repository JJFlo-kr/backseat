# Backseat glossary

One term per concept, in every language. Korean (`ko`) is the source, English (`en`) the reference for
translators and the fallback for missing keys. Product name **Backseat** is never translated.
Tool / file names stay as they are: MCP, `brief.md`, `annotated.png`, `screenshot.png`, `transcript.json`,
`backseat_latest`, `backseat_wait`, `backseat_ask`, Whisper, Ctrl+V, Enter, Esc.

| ko | en | Meaning / note |
|---|---|---|
| 캡처 | capture | A frozen screenshot the user annotates. Verb "capture" too. |
| 영역 / 창 / 전체 화면 / 스크롤 캡처 | region / window / full screen / scrolling capture | The four capture modes. |
| 주석 | annotation | Anything the user draws (pen, arrow, rectangle, number, text, blur). Not "comment". |
| 펜 · 화살표 · 사각형 · 번호 · 텍스트 · 블러 · 자르기 · 지우개 | Pen · Arrow · Rectangle (short: Rect) · Number · Text · Blur · Crop · Eraser | Editor tools. Toolbar buttons use the shortest natural form. |
| 브리프 | brief | `brief.md`, the markdown description for the agent. Keep "brief" (not "summary"). |
| 세션 패키지 / 세션 | session package / session | The folder written on every send (image, brief, strokes, audio). |
| 전송 | Send | Delivering the package to the agent window. Button text: one short verb. |
| 전송 대상 / 대상 | target | The window that receives the package. "Send to …", "target window". |
| 에이전트 | agent | AI coding agent (Claude Code, Codex, Cursor…). |
| 고정 (편집기) | Pin / pinned | Keep the editor on top as a reference window. |
| 기본 대상으로 고정 | pin as default target | Remember a target window for future sends. |
| 메모 | note | The one-line text field for the whole image. |
| 녹음 | record (voice) | Microphone recording. |
| 녹화 | video (export) | WebM replay of the drawing session. Do not mix with "record". |
| 전사 / 음성 인식 | transcription / speech recognition | Whisper turns speech into text. |
| 발화 | speech line | One transcribed sentence (🗣 in the brief). |
| 연결 (발화↔주석) | link | Attaching a speech line to an annotation in the timeline. |
| 타임라인 | Timeline | Bottom panel with drawing and speech over time. |
| 전/후 비교 | Before/after | Compare with the previous capture; modes: 겹치기 Overlay · 와이프 Wipe · 차이 Difference. |
| 클립보드 | clipboard | |
| 트레이 | tray | The notification-area icon and its menu. |
| 되돌리기 / 다시 실행 | Undo / Redo | |
| 배경 상자 / 윤곽선 / 그림자 | background box / outline / shadow | Text effects. |
| 굵기 | width (stroke) | Pen / shape thickness. "굵게" for text = Bold. |
| 질문 / 요청 (backseat_ask) | question / request | An agent asking the user to show something. |

## Tone

- UI: short, plain, imperative for actions ("Send", "Copy"), sentence case in English.
- Status messages: past tense or "…ing…" with an ellipsis (`Sending…`, `Saved: <path>`).
- Brief and MCP text are read by AI agents: precise and literal, no marketing.
- Per language: ja です/ます in sentences, plain nouns on buttons · zh-CN / zh-TW concise, no 您 overuse
  (use 你 or omit) · es / pt-BR / fr informal imperative on buttons, neutral (no tú/vous) in sentences where
  possible; if a pronoun is needed use tú / você / vous consistently · de du-form imperatives consistently
  (no Sie), as common in modern apps.
