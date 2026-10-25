<p align="center"><img src="resources/logo.svg" width="112" alt="Backseat logo"></p>

# Backseat (AI 소통기)

[English](README.md) · **한국어**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-jjflo-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/jjflo)

화면을 캡처하고, 그 위에 그리면서 말하고, 그대로 AI 코딩 에이전트에게 보내는 Windows 도구입니다.
"backseat driver"에서 이름을 땄습니다. AI가 운전(코딩)하고, 사용자는 뒷좌석에서 화면을 가리키며 지시합니다.

<p align="center">
  <a href="https://jjflo-kr.github.io/backseat/ko/"><img src="docs/media/backseat-demo.gif" width="760" alt="Backseat 시연: 로그인 화면을 캡처해 말하면서 표시하고 Codex CLI로 보내면 화면이 고쳐지는 모습"></a>
</p>
<p align="center">
  <a href="https://jjflo-kr.github.io/backseat/ko/"><b>소개 사이트와 1분 소개 영상(소리 포함)</b></a><br>
  <sub>시연: 실제 앱을 스크립트로 조작해 녹화, 음성은 TTS, 에이전트는 Codex CLI(실제 1회 실행).</sub>
</p>

## 시작하기

1. **설치하세요.** [Releases](https://github.com/JJFlo-kr/backseat/releases/latest)에서 최신
   `Backseat Setup <버전>.exe`를 받아 실행하세요. Backseat이 화면 오른쪽 아래 트레이에 뜨고, 다음부터는
   Windows에 로그인할 때 자동으로 켜집니다.
2. **캡처하세요.** AI(Claude Code, Codex, Cursor, 브라우저 채팅 등)와 대화하다가 보여 주고 싶은 화면으로 가서
   `Ctrl+Shift+A`를 누르고, 가리키고 싶은 부분을 드래그하세요.
3. **표시하고 설명하세요.** 화살표·사각형·번호를 그리거나 글자를 넣고, `M`을 눌러 원하는 내용을 말로 설명하세요.
4. **보내세요.** `Enter`를 누르면 최근에 쓰던 AI 창의 입력란에 붙여넣습니다. 내용을 확인하고 그 창에서 Enter를
   누르면 AI에게 전달됩니다. 입력란을 확인하지 못하거나 비밀번호 칸이면 붙여넣지 않고 클립보드에 준비해 둡니다.
   캡처한 페이지나 메신저에는 직접 고르지 않는 한 보내지 않습니다.

설치 파일에 아직 코드 서명이 없어 처음 실행할 때 SmartScreen 경고가 뜰 수 있습니다. "추가 정보" → "실행"을 누르세요.

## Backseat이 다른 점

- **Windows 화면 어디든** 캡처할 수 있습니다. 터미널, 일반 앱, 만들고 있는 앱, 긴 스크롤 페이지까지.
- **그린 것과 말한 것이 함께 갑니다.** "이거 키워 줘"라고 말할 때 그리던 화살표에 그 말이 붙어서, 정확한 좌표와 함께
  AI에게 전달됩니다.
- **여러 에이전트와 함께 쓰고, 에이전트가 되물을 수도 있습니다.** MCP로 연결하면 에이전트가 캡처를 직접 가져가고,
  보여 달라고 요청하면 그려서 답할 수 있습니다.

## 기능

| 동작 | 키 |
|---|---|
| 영역 캡처 / 창 캡처 | `Ctrl+Shift+A` / `Ctrl+Shift+W` — 선택 화면에서 R / W / F / S로 전환 |
| 긴 페이지 스크롤 캡처 | 선택 화면에서 `S`를 누르고 창 클릭 — `Esc`로 중단 |
| 도구 | 펜 P · 텍스트 T · 화살표 A · 사각형 R · 번호 N · 블러 B · 자르기 C · 지우개 E |
| 색 | 색 버튼: 팔레트, 최근 색, 직접 선택, 스포이트 |
| 글자 효과 | 배경 상자·윤곽선·효과 없음 · 상자 색과 불투명도 · 그림자 · 굵게 / 기울임 |
| 글자 입력 | `Enter` 완료 · `Shift+Enter` 줄바꿈 · `Esc` 취소 · 더블클릭으로 다시 편집 |
| 음성 | `M`으로 녹음 시작·정지. 말한 내용을 그때 그린 표시와 함께 저장합니다 |
| 타임라인 | `L` 열기 · `Space` 재생 · `End` 현재 시점으로 · `Ctrl+E` 영상 저장 |
| 전/후 비교 | 트레이 "마지막 영역 다시 캡처"로 다시 찍은 뒤 `O`: 겹치기·좌우 비교·차이 |
| 보낼 곳 바꾸기 | 대상 바 클릭 또는 `Ctrl+T`, 트레이 "보낼 곳". 고른 창은 닫힐 때까지 유지되고, 자주 쓰는 창은 기본 대상으로 고정할 수 있습니다 |
| 되돌리기 / 다시 실행 | `Ctrl+Z` / `Ctrl+Shift+Z` |
| 전송 · 저장 · 복사 | `Enter` · `Ctrl+S` · `Ctrl+C` |

Backseat으로 그린 표시에는 구분 표시가 붙고, 표시가 없는 원래 화면도 함께 보내서 AI가 둘을 헷갈리지 않습니다.

## 언어

화면 언어는 Windows 언어를 따릅니다: 한국어, English, 日本語, 简体中文, 繁體中文, Español, Português (Brasil),
Deutsch, Français(그 밖의 언어는 영어). 트레이 아이콘 → **언어 / Language**에서 바꿀 수 있고, 같은 메뉴에서
브리프를 항상 영어로 쓰게 하거나 음성 인식 언어를 고를 수 있습니다.

## 에이전트 연결 (MCP)

트레이 아이콘 우클릭 → **MCP 연결 설정 복사**를 누른 뒤, 에이전트의 MCP 설정(Claude Code라면 프로젝트의 `.mcp.json`)에
붙여넣으세요. 아래처럼 생겼고 Node.js가 필요합니다.

```json
{ "mcpServers": { "backseat": { "command": "node", "args": ["C:/Users/<사용자>/AppData/Local/Programs/Backseat/resources/app.asar.unpacked/out/main/mcp-server.js"] } } }
```

## 후원

Backseat은 모든 기능을 무료로 사용할 수 있습니다. 개발을 응원하고 싶다면
[커피 한 잔](https://buymeacoffee.com/jjflo)을 후원해 주세요.

## 더 보기

- 소스에서 빌드, 테스트, 음성 인식 설정, 파일 형식: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) (영어)
- 이 저장소에서 작업하는 AI 코딩 에이전트용 안내: [AGENTS.md](AGENTS.md)
- 설계와 진행 기록: [PLAN.md](PLAN.md)

## 라이선스

[MIT](LICENSE) © 2026 wowls2162. 사용한 오픈소스의 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 있습니다.
