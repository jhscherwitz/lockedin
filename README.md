# Focus

A single-page focus and study dashboard: a Pomodoro timer, layerable ambient
sounds, and Spotify playlists, all on one calm screen.

Built with plain HTML, CSS, and JavaScript. No frameworks, no build step.

## Running it locally

You need Python installed. From the project folder:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000> in your browser.

## Status

In progress.

**Done**
- Step 0 — project skeleton
- Step 1 — animated gradient background, live clock
- Step 2 — Pomodoro timer (focus / short break / long break)
- Step 3 — corner docks and sliding frosted panels
- Step 4 — ambient sound mixer (Web Audio noise + MP3 slots)
- Step 5 — timer modes, settings tabs, segmented control
- Step 6 — clock options (12/24 + timezone), themes, timer font picker
- Step 7 — task list and notepad
- Step 8 — everything saves between visits
- Step 9 — seven ambient sound recordings wired up
- Step 10 — background performance rewrite (no per-frame blurs)

**Next**
- Spotify playlists, merged into the sounds panel — needs playlist links
- Confirm the project name (leading candidate: LockedIn)
- Deploy to a public URL

**Known**
- `underwater.mp3` is 7 seconds, so its loop is audible. Worth replacing.
