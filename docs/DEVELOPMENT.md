# Developing Backseat

User documentation is in [README.md](../README.md). Guidance for AI coding agents (layout, rules, contracts)
is in [AGENTS.md](../AGENTS.md); design history in [PLAN.md](../PLAN.md) (Korean).

## Build and run from source

Requires Windows 10/11 x64 and Node 24.

```sh
npm install        # if electron.exe is missing afterwards: node node_modules/electron/install.js
npm run build
npm start          # tray app; a development run never registers itself to start at login
npm run dist       # installer → dist\Backseat Setup <version>.exe
```

Stop a running tray app (`electron.exe`) before `npm install` or `npm run dist`, or files stay locked.

Keep the project in a normal folder such as `D:\backseat`. Under a virtualized AppData folder (for example a
Claude app scratch folder) the Electron sandbox and the Vite renderer build break.

## Tests

- `npm run typecheck`, `npm test` — unit tests for the pure logic: language packs (same keys and placeholders
  in every bundle), pointing words, speech alignment, transcript grouping, scroll stitching, the cloud speech
  adapter (mock server), palettes, target detection.
- `npm run selftest -- --selftest-shots=<dir>` — end-to-end on the real desktop: capture, window list,
  selector and editor rendering, timeline scrubbing, undo/redo, crop, before/after, scrolling capture (own test
  window), cloud speech (local mock), text styling, color popover and eyedropper, target menu, clipboard,
  session packages and brief checks. Options: `--selftest-wav=<wav>` also checks speech recognition,
  `--selftest-no-scroll` skips the step that moves the real mouse wheel, `--selftest-no-stt`.
- `npm run selftest -- --selftest-locale=all --selftest-shots=<dir>` — selector, editor and About window in
  every language: no visible message keys, toolbar fits at 820 px, the Japanese / Chinese fonts load.
- `node scripts/mcp-check.mjs <sessionsRoot> [out/main/mcp-server.js]` — the MCP server against the official
  client, including an ask round trip.

## Session packages

Every send writes `Pictures\Backseat\sessions\<id>\`:

| File | Content |
|---|---|
| `annotated.png` | The capture with the user's marks (text carries a purple "B" tag, number badges a purple ring) |
| `screenshot.png` | The same capture without marks (blur boxes still applied) |
| `brief.md` | Markdown for the agent: capture info, marks with pixel coordinates, the speech attached to each |
| `strokes.json` | The annotations as data |
| `transcript.json`, `audio.webm` | Speech recognition result and the recording, when the user spoke |
| `meta.json` | Capture metadata, target, file list, answered request id |

## MCP server

`out/main/mcp-server.js` is a stdio MCP server run by plain Node. The MCP SDK and zod are bundled into it, and
the installer unpacks it (with `out/main/chunks/`) outside `app.asar` into `resources/app.asar.unpacked`, so no
`node_modules` is needed. Source checkout: `{ "command": "node", "args": ["D:/backseat/out/main/mcp-server.js"] }`.

Tools: `backseat_register`, `backseat_latest` (brief + image), `backseat_list`, `backseat_get`,
`backseat_wait` (wait for the next send), `backseat_ask` (show a question and wait until the user answers by
drawing), `backseat_agents`. Copy `integrations/claude-code/SKILL.md` to `.claude/skills/backseat/` for a
`/backseat` skill in Claude Code.

## Speech recognition

Whisper runs locally through transformers.js (ONNX). The default model
`onnx-community/whisper-small_timestamped` (word timestamps) is downloaded on the first recording and cached in
`%APPDATA%\backseat\models`. `BACKSEAT_STT_MODEL` selects another one (e.g.
`onnx-community/whisper-large-v3-turbo_timestamped`: more accurate, larger).

Cloud recognition: set `"sttBackend": "openai"` in `%APPDATA%\backseat\config.json` (and `sttApiBase`,
`sttCloudModel` if needed). The API key comes only from the environment variable `BACKSEAT_STT_API_KEY` and is
never written to a file. Any OpenAI-compatible `/v1/audio/transcriptions` endpoint (verbose_json, word
timestamps) works.

## Settings file

`%APPDATA%\backseat\config.json` (tray → "Open settings file"): hotkeys, `locale` ('auto' or a language code),
`briefLocale` ('follow' | 'en'), `sttLanguage` ('auto' | 'detect' | a Whisper language), `pressEnter`,
`autoRecord`, `scrollMaxHeightPx`, the pinned target, speech backend settings.
