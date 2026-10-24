<p align="center"><img src="resources/logo.svg" width="112" alt="Backseat logo"></p>

# Backseat

**English** · [한국어](README.ko.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-jjflo-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/jjflo)

A free Windows tray app for working with AI coding agents: capture your screen, draw on it while you talk,
and send it straight to the agent you were working with. The name comes from "backseat driver" — the AI
drives (writes the code), you sit in the back, point at the screen and tell it where to go.

What makes it different:

- **The whole Windows desktop, not just a browser tab.** Any app, window, full screen or a long scrolling page
  can be captured and marked up — terminals, native apps, design tools, the app you are building.
- **Drawings and speech stay tied together.** Backseat records *when* you drew each mark and *when* you said
  each sentence, and writes a brief that attaches "make this bigger" to the arrow you were drawing while you
  said it — with pixel coordinates, so the agent knows exactly what "this" means.
- **Many agents, and they can ask back.** Delivery works with Claude Code in a terminal, the Claude app,
  ChatGPT/Codex, Cursor, VS Code, browser chats and any other window. A bundled MCP server lets an agent fetch
  captures itself and *ask you* to show something (`backseat_ask`): you answer by drawing.

Available in 9 languages: English, 한국어, 日本語, 简体中文, 繁體中文, Español, Português (Brasil), Deutsch, Français.

## Install and run

1. Run `Backseat Setup <version>.exe` from the [releases page](https://github.com/JJFlo-kr/backseat/releases).
   **Backseat** appears in the Start menu and on the desktop.
2. Start Backseat: an icon appears in the notification area (tray). There is no main window — press
   `Ctrl+Shift+A` to capture.
3. The installed app **starts when you log in to Windows**. To turn that off: right-click the tray icon →
   uncheck "Start at login".
4. To update, run the new installer over the old one (settings and sessions are kept).

The installer is not code-signed yet, so Windows SmartScreen may warn the first time ("More info" → "Run anyway").

Running from source (only when changing the code):

```sh
npm install
npm run build
npm start          # tray app (a development run never registers itself to start at login)
npm run dist       # build the installer → dist\Backseat Setup <version>.exe
```

## How to use

| Action | Key |
|---|---|
| Capture a region (the screen freezes, drag to select) | `Ctrl+Shift+A` |
| Capture a window (click the window under the mouse) | `Ctrl+Shift+W` — inside the selector, switch with R/W/F/S |
| Scrolling capture (scrolls a long page and stitches it) | `S` in the selector, then click the window — `Esc` stops |
| Editor tools | Pen P · Text T · Arrow A · Rectangle R · Number N · Blur B · Crop C (all undoable) |
| Before/after (when captured with the tray's "Recapture last region") | O — overlay / wipe / difference, recorded as one line in the brief |
| Colors | The color button → palettes (vivid, calm, pastel, mono), 6 recent colors, custom / hex, eyedropper |
| Text styling (third toolbar row with the Text tool) | Background box / outline / none · box color, auto, opacity · ⇄ swap · outline color · shadow · **B** *I* |
| Typing text | Enter finishes · Shift+Enter new line · Esc cancels · double-click to edit again |
| Change the target | Click the target bar or Ctrl+T → ↑↓ Enter. "Pin this window as the default target" makes it win from then on (unpin in the tray) |
| Start / stop voice recording | M (talk while you draw: each sentence attaches to the mark you were drawing) |
| Timeline / play / live | L · Space · End |
| Undo / redo | Ctrl+Z · Ctrl+Shift+Z |
| **Send** (to the agent you were working with) | Enter |
| Save / copy / export video | Ctrl+S · Ctrl+C · Ctrl+E |

Sending writes a **session package** to `Pictures\Backseat\sessions\<id>\` (annotated.png, screenshot.png,
brief.md, strokes.json, transcript.json, audio.webm, meta.json) and pastes either an instruction line with the
brief's path or the image itself into the window you were using right before the capture (Claude Code in a
terminal, the Claude app, the ChatGPT/Codex app, Cursor, VS Code, a browser chat, any other app). You press
Enter yourself (or turn on "Press Enter after sending" in the tray).

So that the AI never mistakes your marks for the real screen, text you add in annotated.png carries a small
purple "B" tag, number badges have a purple ring, the capture without annotations is saved as screenshot.png
(blur boxes are applied to it too), and the first line of brief.md says so.

## Languages

The UI language follows Windows by default (English for languages Backseat does not have yet). Change it under
right-click on the tray icon → **Language**; the tray switches at once, open editors from the next capture on.

- **Write briefs in English** (tray checkbox): keep the UI in your language but write brief.md and the pasted
  instruction in English.
- **Speech language** (tray submenu): same as the app language by default, or "Detect automatically".
- Japanese and Chinese text annotations use bundled Noto Sans JP / SC / TC, which become the Text tool's default
  font in those languages.

## Connecting agents (MCP)

Backseat includes a stdio MCP server (`mcp-server.js`). **Right-click the tray icon → "Copy agent connection
(MCP) config"** puts a config pointing at your install on the clipboard; for Claude Code, paste it into the
project's `.mcp.json`. Requires Node.js (`node`).

- Installed app (default location):
  ```json
  { "mcpServers": { "backseat": { "command": "node", "args": ["C:/Users/<user>/AppData/Local/Programs/Backseat/resources/app.asar.unpacked/out/main/mcp-server.js"] } } }
  ```
  The server file bundles the MCP SDK and zod and is unpacked outside `app.asar`, so plain Node can run it.
- Source checkout: `{ "command": "node", "args": ["D:/backseat/out/main/mcp-server.js"] }`

Tools: `backseat_register`, `backseat_latest` (brief + image), `backseat_list`, `backseat_get`, `backseat_wait`
(wait for the next send), `backseat_ask` (show a question and wait until the user answers by drawing). Copy
`integrations/claude-code/SKILL.md` to `.claude/skills/backseat/` to get a `/backseat` skill.

## Speech recognition

Whisper runs locally through transformers.js (ONNX). The default model
`onnx-community/whisper-small_timestamped` (word timestamps) is downloaded on the first recording and cached in
`%APPDATA%\backseat\models`. Set `BACKSEAT_STT_MODEL` to use another one (e.g.
`onnx-community/whisper-large-v3-turbo_timestamped`: more accurate, larger).

For cloud recognition set `"sttBackend": "openai"` in `config.json` (and `sttApiBase` / `sttCloudModel` if
needed) and pass the API key **only through the environment variable `BACKSEAT_STT_API_KEY`** (it is never
written to a file). Any server with an OpenAI-compatible `/v1/audio/transcriptions` (verbose_json, word
timestamps) works.

## Testing

- `npm test` — unit tests: language packs (same keys and placeholders in every language), pointing words,
  speech alignment, transcript grouping, scroll stitching, the cloud STT adapter (mock server), palettes,
  target detection.
- `npm run selftest` — end-to-end on the real desktop: capture, window list, selector and editor rendering,
  timeline scrubbing, undo/redo, crop, before/after, scrolling capture (own test window), cloud STT (local mock),
  text styling, color popover and eyedropper, target menu, clipboard, session packages and brief checks.
  `--selftest-wav=<wav>` also checks speech recognition; `--selftest-locale=<code>` runs the UI in another
  language.
- `node scripts/mcp-check.mjs <sessionsRoot>` — the MCP server against the official client (including an ask
  round trip).

## Notes

- Do not keep the project under a virtualized AppData folder (such as a Claude app scratch folder): the Electron
  sandbox and the Vite build break there. Use a normal folder like `D:\backseat`.
- Design and progress: [PLAN.md](PLAN.md) (Korean). Guide for AI coding agents: [AGENTS.md](AGENTS.md).
  Having another AI review the code: [docs/codex-review.md](docs/codex-review.md) (Korean).

## Support

Backseat is **free**, with every feature unlocked. If it helps you, a coffee on
[Buy Me a Coffee](https://buymeacoffee.com/jjflo) is much appreciated — entirely optional (the tray's
"Support ☕" item and the About window link to the same page). The link lives in
[`src/shared/links.ts`](src/shared/links.ts) (`SUPPORT_URL`) and in this README.

## License

[MIT](LICENSE) © 2026 wowls2162. Licenses of the open-source software used are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
