<p align="center"><img src="resources/logo.svg" width="112" alt="Backseat logo"></p>

# Backseat

**English** · [한국어](README.ko.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-jjflo-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/jjflo)

Capture your screen, draw on it while you talk, and send it straight to your AI coding agent — on Windows.
The name comes from "backseat driver": the AI drives, you sit in the back and point at the screen.

## Getting started

1. **Install.** Download the latest `Backseat Setup <version>.exe` from
   [Releases](https://github.com/JJFlo-kr/backseat/releases/latest) and run it. Backseat starts in the
   notification area (tray) and from then on whenever you log in.
2. **Capture.** In the window where you talk to your AI (Claude Code, Codex, Cursor, a browser chat…), press
   `Ctrl+Shift+A` and drag over the part of the screen you mean.
3. **Mark it and explain.** Draw arrows, boxes or numbers, add text, and press `M` to say what you want while
   you draw.
4. **Send.** Press `Enter`. Backseat pastes your capture into the window you came from; check it and press
   Enter there to send it to the AI.

The installer is not code-signed yet, so Windows may show a SmartScreen warning the first time
("More info" → "Run anyway").

## Why Backseat

- **Any window on your desktop** — terminals, native apps, the app you are building, a long scrolling page.
- **What you draw and what you say stay together.** The brief your agent reads ties "make this bigger" to the
  arrow you were drawing when you said it, with exact coordinates.
- **Works with many agents, and they can ask back.** With the MCP connection an agent can fetch your captures
  itself and ask you to show it something; you answer by drawing.

## Features

| Action | Key |
|---|---|
| Capture a region / a window | `Ctrl+Shift+A` / `Ctrl+Shift+W` — switch with R / W / F / S in the selector |
| Scrolling capture of a long page | `S` in the selector, then click the window — `Esc` stops |
| Tools | Pen P · Text T · Arrow A · Rectangle R · Number N · Blur B · Crop C · Eraser E |
| Colors | Color button: palettes, recent colors, any color, eyedropper |
| Text style | Background box, outline or plain · box color and opacity · shadow · bold / italic |
| Text | `Enter` finishes · `Shift+Enter` new line · `Esc` cancels · double-click to edit |
| Voice | `M` starts and stops recording; what you say is saved with the marks you drew at that moment |
| Timeline | `L` opens it · `Space` plays · `End` jumps to now · save the replay as a video with `Ctrl+E` |
| Before/after | Capture again with "Recapture last region" in the tray, then `O`: overlay, split or difference |
| Change where it goes | Click the target bar or `Ctrl+T`; you can pin a window as the default target |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Send · save · copy | `Enter` · `Ctrl+S` · `Ctrl+C` |

Marks you add are tagged so the AI can tell them from the real screen, and the original screenshot is sent
along with the marked-up one.

## Languages

Backseat follows your Windows language: English, 한국어, 日本語, 简体中文, 繁體中文, Español,
Português (Brasil), Deutsch, Français (others fall back to English). Change it from the tray icon → **Language**.
In the same menu you can have briefs always written in English and choose the speech language.

## Connecting an agent (MCP)

Right-click the tray icon → **Copy MCP connection settings**, then paste it into your agent's MCP
configuration (for Claude Code, the project's `.mcp.json`). It looks like this and needs Node.js:

```json
{ "mcpServers": { "backseat": { "command": "node", "args": ["C:/Users/<you>/AppData/Local/Programs/Backseat/resources/app.asar.unpacked/out/main/mcp-server.js"] } } }
```

## Support

Every feature of Backseat is free. If you would like to support its development, you can
[buy me a coffee](https://buymeacoffee.com/jjflo).

## More

- Building from source, tests, speech settings and file formats: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- Guide for AI coding agents working on this repository: [AGENTS.md](AGENTS.md)
- Design notes and history (Korean): [PLAN.md](PLAN.md)

## License

[MIT](LICENSE) © 2026 wowls2162. Open-source licenses of the components used:
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
