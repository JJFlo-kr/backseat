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
  client, including an ask round trip and the fetch receipts.
- `npm run selftest-delivery` — the delivery checks on the real desktop: a fake AI chat and a fake sign-in page
  (`tests/fixtures/delivery`, fake account only) in a separate Chrome / Edge profile, sent to through the real
  editor IPC, UI Automation and Ctrl+V. Six situations from the 2026-10-24 incident report (sign-in page
  captured after using the AI, password field focused, AI input not focused, two windows of one app / a
  changed tab, focus moving away, target closed and a retry). It moves the focus between windows and uses the
  clipboard (restored afterwards): only while nobody uses the machine. Prints `BACKSEAT_DELIVERY_TEST {json}`.

Self-tests that move the real focus, mouse or keyboard run one at a time: create `D:\backseat-ui-test.lock`
only when it does not exist, delete it afterwards (a lock older than an hour may be removed).

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
drawing), `backseat_agents`.

Every package handed out by `backseat_get` / `latest` / `wait` / `ask` leaves a fetch receipt,
`<sessions>/receipts/<id>/<agent>-<ms>-<rand>.json` (send id, registered agent id, name, cwd, tool, time),
one file per fetch, written atomically. The app watches the receipts of its last send and tells the editor
("AI가 자료를 가져갔어요" — fetched, not understood). The line pasted into an MCP-verified agent asks for
`backseat_get` with that send id.

## Delivery

Where 보내기 goes is decided apart from the capture (`src/main/targets.ts`): the user's pick → the pinned
default → a window an MCP agent provably runs in → the AI window used last (`tracker.ts`) → the AI app in front
→ none. Before Ctrl+V `src/main/send.ts` checks the same window instance (hwnd + pid + process start time,
title for browser tabs), brings it forward, and asks UI Automation (`native/uia-com.ts`, koffi COM in a worker
thread) whether the focused element is an editable, non-password field of that process. The result is a
`DeliveryStatus` with only the confirmed steps. `<userData>\logs\delivery.log` records steps and verdicts
(element type, password yes/no, reason codes) — never titles, clipboard text, memos or field values. Copy `integrations/claude-code/SKILL.md` to `.claude/skills/backseat/` for a
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
