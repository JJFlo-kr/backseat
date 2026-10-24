---
name: backseat
description: Read the user's latest Backseat capture (annotated screenshot + spoken instructions aligned to the drawings) and carry out the changes it asks for. Use when the user says they sent something from Backseat, pastes a Backseat brief path, or asks you to look at what they drew or circled on screen.
---

# Backseat (AI 소통기)

The user captures their screen, draws on it (pen, arrows, numbered badges, text) while speaking, and sends the
result here. Each send is a **session package** folder:

- `annotated.png` — the screenshot **plus** what the user drew: colored lines/arrows/rectangles, violet-ringed numbered circles, and text with a small violet "B" tag at its top-left. All of that is the user's Backseat annotation, NOT part of the real screen
- `screenshot.png` — the same capture without any annotations (blur boxes still applied); use it to read the real on-screen text
- `brief.md` — what to do: capture context, memo, the numbered annotations with pixel coordinates and timing,
  and under each one the 🗣 sentences the user said while drawing it (with auto/manual link and a confidence)
- `strokes.json`, `transcript.json`, `audio.webm` — raw data (rarely needed)

## How to read it

1. If the `backseat` MCP server is available, call `backseat_latest` (brief + annotated image inline; pass `includeOriginal: true` to also get `screenshot.png`). Otherwise read
   the `brief.md` path the user pasted, then view `annotated.png` (and `screenshot.png` when you need the unmarked screen) next to it.
2. Map each numbered annotation to the UI element at those pixel coordinates in the image. Arrows mean
   "this → there" or "look here"; badges number the spots the user talks about; blur boxes hide secrets — ignore them.
3. Treat the 🗣 lines as the instruction for that spot. Low-confidence or "전역 지시" lines apply to the whole
   screen. Speech is machine-transcribed: numbers and product names may be wrong ("1.5배" → "1.5팩"), so
   prefer the reading that makes sense for the UI.
4. Find the code that renders that screen (match window title, visible text, component names) and make the
   change. Say which annotation each change addresses.

## Asking the user to show you something

Call `backseat_ask` with a question in the user's language ("어느 버튼이 문제인지 동그라미 쳐 주세요"). The tray
app notifies the user; when they capture, draw, speak and press Enter, the tool returns their answer package.
`backseat_wait` does the same without a question. Register once per session with
`backseat_register(name, cwd, kind)` so the user sees you as a send target.
