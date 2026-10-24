# Backseat logo concepts

All three are 256×256 flat SVGs using only Backseat red `#E5484D` and white. Renders are in `png/` at 256/64/32/16 px. `png/previews.png` shows each concept at 256 px, with its 32 px and 16 px renders (plus the 16 px enlarged 4×) on dark `#1b1b1f` and light `#f0f0f0` strips. To regenerate: `node scripts/render-logo.cjs design/logo/a-pointing-silhouette.svg design/logo/b-finger-badge.svg design/logo/c-seat-cursor.svg design/logo/png`. The script uses sharp when it loads. Otherwise it screenshots the SVGs with headless Chrome/Edge.

**A: pointing silhouette (`a-pointing-silhouette.svg`).** Seen from behind: a round head over a seat back that runs off the bottom of the red circle, with one arm thrown up to the right and the index finger jabbing at the windshield. This is the user's picture taken literally: someone in the back seat bossing everything around with a finger. A thin red halo separates the arm from the head and the seat. At 16 px it reduces to a white dot plus a bold diagonal stroke rising out of a white block. It still reads as "a person with a raised, pointing arm" on both dark and light taskbars, and the red circle keeps the same outline as the current icon.

**B: finger badge (`b-finger-badge.svg`).** A geometric pointing hand (fist, thumb, one knuckle bump, long index finger, tilted slightly up) on a forearm that rises from behind a seat back, inside a red rounded square. At 256 and 64 px it is the friendliest and most "emoji-like" of the three. But the hand needs several parts to avoid looking like a letter: earlier versions read as "E"/"F". At 16 px those parts merge into an unreadable white mass with a stub on top. It is a good large app or installer illustration, but it is not a tray icon.

**C: seat + cursor (`c-seat-cursor.svg`).** A car seat seen from behind (headrest on two posts, tapered seat back) with an arrow cursor rising from its shoulder towards the top right: "the seat gives the orders, on screen". It is the most minimal and has the most software feel. At 16 px the cursor triangle stays crisp, but the headrest posts disappear, so the seat becomes a generic white blob. Overall it reads as "something + cursor" rather than "back seat".

**Recommendation: A.** It is the only concept where the back-seat-driver idea (a person pointing and giving orders) survives at 16 px: the raised diagonal arm is the strongest silhouette in the set on both strip colours. It also keeps the red-circle shape users already know from the current icon. C is a reasonable fallback if a more abstract, tool-like mark is wanted. B is best kept for large marketing use only.

## Snap concepts (손가락 딸깍)

A newer direction: draw only the hand. The boss in the back seat snaps their fingers and the work gets done. The three are red + white like the earlier concepts. To regenerate the renders and the `png/previews-snap.png` sheet, which uses the same layout as `previews.png`: `node scripts/render-logo.cjs --sheet=previews-snap.png design/logo/d-snap-side.svg design/logo/e-snap-front.svg design/logo/f-snap-minimal.svg design/logo/png`.

**D: side snap (`d-snap-side.svg`).** A side view of a hand mid-snap, on the red circle. The index finger points straight up. The middle finger bends over at a geometric knuckle and presses onto the thumb tip. The ring and little fingers are a single curled bump on the palm. Three short ticks radiate from the contact point. Red halos separate the overlapping fingers. At 256 and 64 px it is the most literal snap, and the "click" ticks sell the sound. At 16 px the halos and the three fingers turn into a busy white hand texture with a raised finger. The ticks become 1 px specks, so the snap itself is no longer legible.

**E: chunky front snap (`e-snap-front.svg`).** An emoji-style silhouette in a red rounded square: a fat palm, one raised index finger, and the thumb and middle finger merged into a single rounded pinch. A bold four-point spark sits at the snap point. Fewer, bigger parts mean it survives reduction. At 16 px it is exactly "hand + spark": a white hand with a finger up and a clearly separate white star in the top-right corner, on both dark and light strips. At 32 px the star still reads as a sparkle or "magic happens", which fits "snap and it gets done".

**F: snap pictogram (`f-snap-minimal.svg`).** Two thick strokes, an angular middle finger and a straight thumb, pinch together at one point on a diagonal wrist, with a three-tick burst. Earlier versions with an open loop read as the letters "D" and "P", so the loop is now closed to a small slit. At 256 px it is a clean, sign-like pictogram. At 16 px it reduces to a white diagonal wedge on a stick, and the ticks almost disappear. Without context it reads as a torch or a brush rather than fingers.

**Recommendation among D/E/F: E.** It is the only one whose 16 px tray render still says both "hand" and "something just happened": the spark is a separate, high-contrast shape that does not merge with the hand. D has the best snap gesture at large sizes but loses it at tray size. F is the most reduced, but it does not read as a hand when small. If E is chosen, the D artwork could still serve as a larger illustration (installer or about screen) with E as the app and tray icon.

## Final mark (2026-10-25): finger snap, rounded square

The shipped logo is `snap-ai/g-square.svg` (copied to `resources/logo.svg`): a hand the instant after a finger snap —
middle finger flicked onto the thumb, index finger up, three "click" strokes — white on #E5484D. The raster concept was
generated with Figma AI (file "Backseat logo — finger snap"), then `scripts/vectorize-logo.cjs` traced the hand with
potrace and redrew the rounded square as exact geometry. Regenerate the app/tray PNGs with `npm run icon` and copy
`design/logo/render/logo-256.png` to `resources/icon.png` and `logo-32.png` to `resources/tray.png`.
