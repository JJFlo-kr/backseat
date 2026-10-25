# Backseat site (static, GitHub Pages)

One-page product site, served later at https://jjflo-kr.github.io/backseat/ . Plain HTML and CSS, no build step, no external fonts or CDNs.

## Files

- `index.html` (English) and `ko/index.html` (Korean): same layout, language switch top-right.
- `assets/style.css`, `assets/site.js` (pauses looping clips for `prefers-reduced-motion`), `assets/logo.svg`, `assets/icon.png` (favicon).
- `social-card.html` renders `social-card.png` (1280x640, Open Graph / Twitter image). Re-render with headless Edge:
  `msedge --headless=new --disable-gpu --hide-scrollbars --screenshot=social-card.png --window-size=1280,640 file:///D:/backseat/site/social-card.html`
- `.nojekyll` tells GitHub Pages not to run Jekyll.
- `_preview/` full-page screenshots (1440 and 390 wide) for review; not needed for publishing.

## Media files to drop in (`media/`)

The pages already reference these exact names. Until the videos exist, the placeholder posters (1920x1040 dark frames) show.

| File | Used for | Attributes |
|---|---|---|
| `hero.mp4`, `hero-poster.jpg` | hero loop | autoplay muted loop playsinline |
| `clip-capture.mp4`, `clip-capture-poster.jpg` | step 1 (Capture and mark) | autoplay muted loop playsinline |
| `clip-voice.mp4`, `clip-voice-poster.jpg` | step 2 (Talk while you draw) | autoplay muted loop playsinline |
| `clip-send.mp4`, `clip-send-poster.jpg` | step 3 (Send) | autoplay muted loop playsinline |
| `clip-safety.mp4`, `clip-safety-poster.jpg` | "Safe by default" | autoplay muted loop playsinline |
| `intro-en.mp4`, `intro-en-poster.jpg` | full intro, English | controls, preload none |
| `intro-ko.mp4`, `intro-ko-poster.jpg` | full intro, Korean subtitles (shown first on the Korean page) | controls, preload none |

Note: `clip-capture.mp4` is an extra name, added because step 1 needs its own clip. If you do not make it, point step 1 at another clip in both HTML files.

Keep the clips small (H.264, no audio track needed) since GitHub Pages serves them as-is.

## Preview locally

Open `index.html` (or `ko/index.html`) directly in a browser. Everything uses relative paths, so it works from `file://`.
If Python really exists on the machine, `python -m http.server` in this folder also works, but Python on this PC is a stub, so open the file instead. (`npx serve` needs network, so it is not an option offline.)
