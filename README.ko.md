<p align="center"><img src="resources/logo.svg" width="96" alt="Backseat 로고"></p>

<h1 align="center">Backseat <sub>AI 소통기</sub></h1>

<p align="center">
  <b>고칠 곳을 화면에 표시하고 말로 설명하면, 사용 중인 AI 코딩 도구에 전달합니다.</b>
</p>

<p align="center">
  <a href="https://github.com/JJFlo-kr/backseat/releases/latest"><b>Windows용 다운로드</b></a>
  ·
  <a href="https://jjflo-kr.github.io/backseat/ko/"><b>데모 보기</b></a>
  ·
  <a href="README.md">English</a>
</p>

<p align="center"><sub>Windows 10(64비트) · 무료 · 오픈소스(MIT) · <a href="#macos와-linux-미리보기판">macOS·Linux 미리보기판</a></sub></p>

<p align="center">
  <img src="docs/media/backseat-demo.gif" width="800" alt="Backseat 시연: 로그인 카드를 드래그해 캡처하고, 말하면서 작은 버튼에 동그라미와 로고에 화살표를 그린 뒤, 문장마다 표시가 연결된 것을 확인하고, Enter로 Codex CLI에 붙여 넣은 다음, 같은 위치에서 고치기 전과 후를 비교하는 장면">
</p>
<p align="center">
  <sub>실제 앱을 스크립트로 조작해 녹화했습니다. 음성은 TTS이고, 수정은 Codex CLI를 한 번 실행한 실제 결과입니다.
  화면 속 앱은 영어 설정입니다. <a href="https://jjflo-kr.github.io/backseat/ko/">소리 있는 50초 영상</a></sub>
</p>

## 시작하기

1. **설치하세요.** [Releases](https://github.com/JJFlo-kr/backseat/releases/latest)에서 `Backseat Setup <버전>.exe`를
   받아 실행하세요. Backseat은 알림 영역에 뜨고, Windows에 로그인할 때마다 켜집니다.
2. **캡처하세요.** 고칠 화면에서 `Ctrl+Shift+A`를 누르고, 가리키고 싶은 부분을 드래그하세요.
3. **표시하세요.** 화살표, 번호, 동그라미로 고칠 곳을 표시하세요. `M`을 눌러 그리면서 말로 설명하거나, 한 줄 메모만
   적어도 됩니다. 음성은 선택입니다.
4. **보내세요.** `Enter`를 누르면 최근에 쓰던 AI 창에 붙여 넣습니다. 붙은 내용을 확인하고 그 창에서 제출하세요.

처음 설치할 때 Windows 경고가 뜰 수 있습니다. [설치 안내](#설치와-windows-경고)를 참고하세요.

### macOS와 Linux 미리보기판

macOS(Apple Silicon)와 Linux(x64 AppImage)용 미리보기판이
[v0.6.0-preview.1 릴리스](https://github.com/JJFlo-kr/backseat/releases/tag/v0.6.0-preview.1)에 있습니다. 캡처, 표시,
음성, 저장, MCP는 Windows판과 같습니다. 보낼 곳을 고르고 입력란을 확인해 붙여 넣는 기능은 Windows 전용이라, 보내기를
누르면 클립보드에 준비되고 직접 붙여 넣어야 합니다(`Cmd+V` / `Ctrl+V`). 창 캡처와 스크롤 캡처는 없습니다. macOS 앱은
Apple 공증을 받지 않았습니다. 처음 열 때 막히면 시스템 설정 → 개인정보 보호 및 보안에서 "그래도 열기"를 누르고, 처음
캡처할 때 화면 기록 권한을 허용하세요. Linux에서는 AppImage에 실행 권한을 먼저 주세요. 알림 영역 아이콘에는
AppIndicator 지원이 필요할 수 있습니다. GitHub의 macOS·Linux 빌드 서버에서 패키지 자체 검사만 통과했고, 실제 Mac·Linux
PC에서는 아직 확인하지 않았습니다.

## 이런 일을 합니다

- **표시와 말이 함께 갑니다.** 말한 문장마다 그때 그리던 표시와 연결되어, "이거 키워 줘"가 그 동그라미와 함께
  전달됩니다.
- **쓰던 AI 창으로 보냅니다.** 방금 캡처한 페이지나 메신저가 아니라 최근에 쓰던 AI 도구를 고릅니다. 붙여 넣기 전에
  입력란을 확인하고, 실제로 확인한 단계만 보여 줍니다.
- **음성은 내 PC에서 텍스트로 변환합니다.** 내 PC의 음성 인식 모델(Whisper)이 받아쓰며, 클라우드 음성 인식을 따로
  설정하지 않는 한 음성을 외부 음성 서비스로 보내지 않습니다.

## 보내는 곳과 들어가는 내용

| 보내는 곳 | 붙여 넣는 내용 | 알아 둘 점 |
|---|---|---|
| 터미널의 AI 에이전트 (Codex CLI, Claude Code 등) | 표시한 이미지와 요청서(`brief.md`)의 파일 경로가 담긴 요청 문장 | 에이전트가 내 PC의 파일을 읽을 수 있어야 합니다. Codex CLI로 처음부터 끝까지 확인했고, Claude Code는 아직 확인하지 못했습니다. |
| 코드 편집기 (Cursor, VS Code, Windsurf, Zed) | 같은 요청 문장을, 커서가 있던 곳(AI 확장의 채팅 입력란이나 내장 터미널)에 | 위와 같은 파일 접근이 필요합니다. 창을 알아보는 규칙만 있고, 실제 편집기에서는 아직 확인하지 못했습니다. |
| Claude·ChatGPT 데스크톱 앱, 브라우저의 AI 채팅 탭 | 표시한 이미지와 요청 문장 | 입력란이 여러 개인 앱은 직접 클릭한 뒤 `Ctrl+V`가 필요할 때가 많습니다. ChatGPT 앱 시험에서는 글자만 들어간 적이 있습니다. |

표시·음성·메모 없이 보내면 이미지만(터미널에는 이미지 경로만) 붙여 넣습니다. 메신저를 포함한 다른 창은 `Ctrl+T`로
직접 고를 수 있습니다. Windows가 비밀번호 칸이라고 알려 주는 입력란에는 붙여 넣지 않습니다. 단, 터미널 안에서 묻는
비밀번호는 구분하지 못합니다.

## 자주 묻는 질문

<details>
<summary id="설치와-windows-경고"><b>설치와 Windows 경고</b></summary>

설치 파일에 아직 코드 서명이 없어 "Windows의 PC 보호" 화면이 뜰 수 있습니다. 실행하기 전에 공식 파일인지
확인하세요. PowerShell에서 아래 명령을 실행하고, 결과를 [릴리스 페이지](https://github.com/JJFlo-kr/backseat/releases/latest)의
파일 옆에 적힌 SHA-256과 비교합니다.

```powershell
Get-FileHash "$env:USERPROFILE\Downloads\Backseat.Setup.0.5.0.exe" -Algorithm SHA256
```

값이 같으면 "추가 정보" → "실행"을 누르세요. 다르면 실행하지 말고 [알려 주세요](https://github.com/JJFlo-kr/backseat/issues).
로그인할 때 자동으로 켜지는 것은 알림 영역의 Backseat 메뉴 → **로그인 시 자동 시작**에서 끌 수 있습니다.
</details>

<details>
<summary><b>음성 기능은 무엇을 내려받고, 음성은 어디로 가나요?</b></summary>

처음 녹음할 때 음성 인식 모델(Whisper small, 약 0.9GB)을 한 번 내려받습니다. 그 뒤로 음성은 내 PC에서 텍스트로
변환합니다. 클라우드 음성 인식을 따로 설정한 경우에만 음성을 그 서비스로 보냅니다. AI 도구에 보낸 내용은 그 도구가
처리합니다.
</details>

<details>
<summary><b>받아쓴 문구가 틀렸어요</b></summary>

편집 창에서 받아쓴 문구를 직접 고칠 수는 없습니다. 한두 단어만 틀렸다면 편집 창 아래의 한 줄 메모 칸에 바른 내용을
적어 함께 보내세요. 많이 틀렸다면 녹음(`M`)을 다시 하세요. 새 녹음이 이전 녹음과 받아쓴 내용을 대신하고, 직접 바꾼
연결도 초기화됩니다. 요청서에는 자동으로 받아쓴 내용이라 숫자나 이름이 틀릴 수 있다는 안내가 들어갑니다.
</details>

<details>
<summary><b>설명이 엉뚱한 표시에 연결됐어요</b></summary>

`L`을 눌러 타임라인을 열고, 음성 줄의 문장 막대를 연결할 표시의 막대 위로 끌어다 놓으세요. 음성 줄의 빈 곳에 놓으면
자동 연결로 돌아갑니다.
</details>

<details>
<summary><b>붙여 넣어지지 않았어요</b></summary>

입력란을 확인하지 못하면 붙여 넣지 않고 클립보드에 준비해 둡니다. AI 창의 입력란을 클릭한 뒤 `Ctrl+V`를 누르세요.
멈춘 이유는 편집 창 아래에 나옵니다.
</details>

<details>
<summary><b>왜 Enter까지 눌러 주지 않나요?</b></summary>

기본 설정에서 Backseat은 붙여 넣기만 하고 제출하지 않습니다. 붙은 내용을 먼저 확인할 수 있게 하려는 것입니다.
알림 영역 메뉴의 **전송 후 Enter 자동 입력**을 켤 수 있지만, 보낼 곳과 입력란을 모두 확인한 경우에만 누릅니다.
</details>

<details>
<summary><b>캡처는 어디에 저장되고, 어떤 언어를 지원하나요?</b></summary>

보낼 때마다 `사진\Backseat\sessions`에 표시한 이미지, 원본 화면, `brief.md`, 그리고 말했다면 녹음과 받아쓴 내용이
저장됩니다. 화면 언어는 Windows 언어를 따릅니다(한국어, English, 日本語, 简体中文, 繁體中文, Español,
Português (Brasil), Deutsch, Français, 그 밖의 언어는 영어). 알림 영역 메뉴 → **언어**에서 바꿀 수 있습니다.
</details>

<details>
<summary><b>단축키와 편집 기능</b></summary>

| 동작 | 키 |
|---|---|
| 영역 캡처 / 창 캡처 | `Ctrl+Shift+A` / `Ctrl+Shift+W` — 선택 화면에서 R / W / F / S로 전환 |
| 긴 페이지 스크롤 캡처 | 선택 화면에서 `S`를 누르고 창 클릭 — `Esc`로 중단 |
| 도구 | 펜 P · 텍스트 T · 화살표 A · 사각형 R · 번호 N · 가리기 B · 자르기 C · 지우개 E |
| 색 | 색 버튼: 팔레트, 최근 색, 직접 선택, 스포이트 |
| 글자 효과 | 배경 상자·윤곽선·효과 없음 · 상자 색과 불투명도 · 그림자 · 굵게 / 기울임 |
| 글자 입력 | `Enter` 완료 · `Shift+Enter` 줄바꿈 · `Esc` 취소 · 더블클릭으로 다시 편집 |
| 음성 | `M`으로 녹음 시작·정지 |
| 타임라인 | `L` 열기 · `Space` 재생 · `End` 현재 시점으로 · `Ctrl+E` 영상 저장 |
| 전/후 비교 | 알림 영역 메뉴의 **마지막 영역 다시 캡처** 뒤 `O`: 겹치기·좌우 비교·차이 |
| 보낼 곳 바꾸기 | 보낼 곳 표시를 누르거나 `Ctrl+T`. 자주 쓰는 창은 기본 대상으로 고정할 수 있습니다 |
| 되돌리기 / 다시 실행 | `Ctrl+Z` / `Ctrl+Shift+Z` |
| 보내기 · 저장 · 복사 | `Enter` · `Ctrl+S` · `Ctrl+C` |

Backseat으로 그린 표시에는 구분 표시가 붙고, 표시가 없는 원래 화면도 함께 보내서 AI가 둘을 헷갈리지 않습니다.
</details>

## 선택: 에이전트가 직접 가져가게 하기 (MCP)

Backseat을 쓰는 데 꼭 필요하지는 않습니다. 에이전트가 MCP를 지원하고, 캡처를 에이전트가 직접 가져가게 하거나
에이전트가 그림으로 답해 달라고 요청하게 하고 싶을 때 설정하세요.

| | MCP 없이 (기본) | MCP 사용 |
|---|---|---|
| 캡처가 에이전트에 가는 방법 | AI 창에 붙여 넣기 | 붙여 넣은 문장이 에이전트에게 가져가라고 하거나, 에이전트가 최신 캡처를 직접 가져감 |
| 편집 창에서 알 수 있는 것 | "붙여넣기를 시도했어요": 붙여넣기 명령을 보냈다는 뜻이며, 실제로 들어갔는지는 AI 창에서 확인 | "AI가 자료를 가져갔어요"까지 |
| 에이전트가 그림으로 답해 달라고 요청 | 안 됨 | 됨 |
| 준비할 것 | 없음 | Node.js, 에이전트 MCP 설정에 항목 하나 |

알림 영역의 Backseat 아이콘을 오른쪽 클릭 → **MCP 연결 설정 복사**를 누른 뒤, 에이전트의 MCP 설정에 붙여 넣으세요.
아래처럼 생겼습니다.

```json
{
  "mcpServers": {
    "backseat": {
      "command": "node",
      "args": [
        "C:/Users/<사용자>/AppData/Local/Programs/Backseat/resources/app.asar.unpacked/out/main/mcp-server.js"
      ]
    }
  }
}
```

도구별 설정(Claude Code, Codex CLI, Cursor): [docs/MCP.md](docs/MCP.md)(영어)

## 더 보기

- 이름의 유래: "backseat driver"에서 따왔습니다. AI가 운전(코딩)하고, 사용자는 뒷좌석에서 화면을 가리키며 지시합니다.
- 소스에서 빌드, 테스트, 음성 인식 설정, 파일 형식: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)(영어)
- 이 저장소에서 작업하는 AI 코딩 에이전트용 안내: [AGENTS.md](AGENTS.md)
- 설계와 진행 기록: [PLAN.md](PLAN.md)

## 후원

Backseat은 모든 기능을 무료로 쓸 수 있습니다. 개발을 응원하고 싶다면:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-jjflo-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/jjflo)

## 라이선스

[MIT](LICENSE) © 2026 wowls2162. 사용한 오픈소스의 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 있습니다.
