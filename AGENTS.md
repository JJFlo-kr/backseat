# AGENTS.md — Backseat (AI 소통기)

Guidance for AI coding agents (Codex, Claude Code, Cursor, …) working in this repository.
Read this first, then `README.md` (user-facing) and `PLAN.md` (design history, decisions, known issues).

## What this is

A Windows tray app (Electron 45 + TypeScript) for "vibe coding": the user presses a hotkey, freezes the
screen, selects a region/window/full screen/scrolling page, draws on it (pen, arrow, rect, numbered badge,
text, blur, crop, eraser) while optionally speaking, and presses Enter. Backseat writes a **session package**
and delivers it to the agent window the user was working in (terminal running Claude Code, Claude app,
ChatGPT/Codex app, Cursor, VS Code, browser chat) by focusing it and pasting.

Speech is transcribed locally with Whisper (transformers.js / ONNX, word timestamps) and each sentence is
aligned to the annotation the user was drawing at that moment (`src/shared/align.ts`). The package's
`brief.md` lists annotations with pixel coordinates and the 🗣 lines attached to each. A stdio MCP server
(`out/main/mcp-server.js`) lets agents pull packages (`backseat_latest/list/get/wait`) and ask the user to
draw an answer (`backseat_ask`).

The UI, the brief and the MCP text come in 9 languages (ko, en, ja, zh-CN, zh-TW, es, pt-BR, de, fr) through
message keys — see **i18n** below. Korean is the source language (the author's); `PLAN.md` and
`README.ko.md` are Korean, `README.md` is English. Code, identifiers and comments are English.

## Layout

| Path | What |
|---|---|
| `src/shared/types.ts` | **The contract** between main, preload and renderers: `Annotation` union, `EditorInit`, `ExportPayload`, `AgentTarget`, `Transcript`, `BackseatApi`. Change it first, then both sides. New fields must be optional (old session packages must still load). |
| `src/shared/ipc.ts` | IPC channel names. Never use string literals for channels elsewhere. |
| `src/shared/align.ts`, `transcript.ts`, `stitch.ts`, `palette.ts` | Pure logic (no Electron, no DOM) — unit-tested in `tests/`. |
| `src/shared/links.ts` | Repo / support URLs (single source; README repeats them). |
| `src/shared/i18n.ts`, `bundles.ts`, `src/main/locales.ts` | i18n: `t()`, locale resolution, fallbacks; all bundles (main / MCP only); UI / brief / speech language from config. |
| `src/locales/*.json`, `_context.json`, `GLOSSARY.md` | Message bundles (flat keys), where each key appears (for translators), terminology. |
| `src/main/index.ts` | App start, hotkeys, capture flow (`startCapture`), target selection. |
| `src/main/capture.ts`, `selector.ts`, `scroll.ts` | Screen capture (desktopCapturer), per-display selector windows, scroll capture + stitching. |
| `src/main/editor.ts` | Editor window + its IPC (save, copy, send, transcribe, pin, video). |
| `src/main/send.ts`, `agents.ts`, `native/win32.ts` | Delivery: classify the foreground window → focus it (`SetForegroundWindow`) → clipboard → `Ctrl+V` (`keybd_event`). Win32 via **koffi**. |
| `src/main/sessions.ts`, `brief.ts` | Session package writer (`Pictures\Backseat\sessions\<id>\`) and `brief.md` generator. |
| `src/main/stt/*` | Speech recognition: worker thread (`worker.ts`), local Whisper or OpenAI-compatible cloud (`openai.ts`, key from env `BACKSEAT_STT_API_KEY` only). |
| `src/main/mcp/*` | MCP server (runs under plain Node, **must never import `electron`**) and the agent registry file. |
| `src/main/config.ts`, `tray.ts`, `about.ts`, `requests.ts` | Settings (`%APPDATA%\backseat\config.json`), tray menu, About window, `backseat_ask` request watcher. |
| `src/main/selftest.ts` | Headless end-to-end self-test (see below). |
| `src/preload/index.ts` | `contextBridge` API (`window.backseat`). Additive changes only. |
| `src/renderer/editor/*` | Annotation editor (vanilla TS + Canvas 2D, ~2.4k lines in `editor.ts`), timeline, color picker, hotkeys registry, undo history. |
| `src/renderer/selector/*`, `about/*` | Region/window selector overlay, About window. |
| `tests/*.test.ts` | Node built-in test runner; imports need `.ts` extensions (Node 24 strips types). |
| `integrations/claude-code/` | `/backseat` skill and `mcp.json` template. |
| `design/logo/`, `scripts/render-logo.cjs`, `vectorize-logo.cjs` | Logo sources and rendering tools (not shipped code). |

## Commands

Requires Windows 10/11 x64 and Node 24.

```sh
npm install                      # if electron.exe is missing afterwards: node node_modules/electron/install.js
npm run typecheck                # tsc --noEmit (TypeScript 7)
npm test                         # unit tests (pure logic) — runs on any OS
npm run build                    # electron-vite → out/
npm start                        # run the tray app (Ctrl+Shift+A / Ctrl+Shift+W)
npm run selftest -- --selftest-shots=<dir> [--selftest-wav=<korean.wav>] [--selftest-no-stt] [--selftest-no-scroll]
npm run selftest -- --selftest-locale=all --selftest-shots=<dir>      # per-language screenshots + checks
node scripts/mcp-check.mjs <sessionsRoot> [out/main/mcp-server.js]   # MCP server against the official client
npm run dist                     # NSIS installer → dist/
```

The self-test captures the real screen, opens the selector and editor, drives them with synthetic input,
records the microphone for ~1.5 s, writes session packages and screenshots, and prints one
`BACKSEAT_SELFTEST {json}` line (`ok`, `errors`, `warnings`). The scroll step moves the real mouse wheel over
a test window — pass `--selftest-no-scroll` while someone is using the machine. It skips the single-instance
lock, so it can run while the tray app is up. The editor exposes a debug hook `window.__backseat.state()`
only when `EditorInit.debug` is set; wait for `state().init` before driving it.

**Not on Windows?** (e.g. a Linux sandbox) Only `npm test` and `npm run typecheck` are meaningful; do a
static review of the rest and say clearly what you could not run.

## Conventions and rules

- Strict TypeScript, no `any`; narrow the `Annotation` union on `kind`.
- Every renderer edit must keep the element ids the self-test relies on (`timeline`, `tl-canvas`, `undo`,
  `redo`, `timeline-toggle`, `copy`, `save`, `send`, `memo`, `status`, `stage`, `wrap`, `base`, `ink`,
  `targetbar`, `mic`, `pin`).
- Renderers run with `contextIsolation: true`, `sandbox: true`, no `nodeIntegration`, and a CSP meta tag.
  Keep it that way; add capabilities through preload + IPC.
- Never write secrets to `config.json`. The cloud STT key is environment-only.
- `koffi`, `onnxruntime-node` and `@huggingface/transformers` are native/large and stay external
  (asarUnpack). The MCP SDK and zod are bundled into `out/main/mcp-server.js` on purpose (installed app has no
  node_modules for plain Node).
- **i18n**: every user-visible string is a key — never hardcode text in any language. Add a new key to
  `ko.json` and `en.json` together (natural English, `GLOSSARY.md` terms), describe it in `_context.json`, and
  give the other 7 bundles a translation, or the English text when none is at hand (runtime fallback is
  en → ko; `npm test` fails while any bundle lacks a key, has a different `{placeholder}` or an empty string).
  Plurals: `<key>.one` + `<key>.other`, called as `t(key, { n })`. Text an agent reads (brief.md, the pasted
  instruction, MCP replies) uses the brief language (`briefTranslator()`), everything else the UI language.
  Renderers: `t()` only after the init message (module scope runs first — make labels lazy), static HTML
  via `data-i18n` / `data-i18n-title` / `-placeholder` / `-aria-label`. Toolbar labels must fit 820 px
  (the locale self-test checks it). Adding a language: PLAN.md §21.
- **Do not copy code from StykAnimate** (GPL-3.0). It was studied for timeline design only (PLAN.md §11).
- Commits: small and focused, message body explains why. Work on a branch; do not push to `main` directly.

## Known issues (see PLAN.md §18–19)

- First capture after app start can leave the selector window white until the hotkey is pressed again.
- Whisper small mishears numbers/proper nouns; brief tells the agent so.
- Unsigned installer → SmartScreen warning.
