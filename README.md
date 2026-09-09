# LockedIn

**[Open it →](https://jhscherwitz.github.io/lockedin/)**

A single-page focus dashboard: a Pomodoro timer, layerable ambient sounds,
tasks and a notepad, on one calm screen.

Built with plain HTML, CSS and JavaScript — no framework, no build step, no
dependencies. Open the folder, run one command, and it works.

## Features

- **Timer with three modes** — countdown, stopwatch, and Pomodoro with
  configurable focus and break lengths and round tracking
- **Pop-out mini timer** — a real always-on-top window (Document
  Picture-in-Picture) so the countdown stays visible while you work elsewhere
- **Ambient sound mixer** — seven recordings, any number playing at once,
  each with its own volume plus a master
- **Tasks and a notepad** — edited in place, saved automatically
- **Eight games for breaks** — Wordle (words), Blackjack, Minesweeper,
  Sequence (pattern memory), Snake, Dino Run, Sudoku with generated puzzles,
  and 2048
- **Spotify playlists**, built-in plus your own, loaded only when you pick one
- **Themes, fonts, 12/24-hour clock, and full timezone support**
- **Keyboard shortcuts** for everything; press `?` to see them
- Everything persists between visits

## Running it locally

Requires Python. From the project folder:

```bash
python serve.py
```

Then open <http://localhost:8000>.

`serve.py` is Python's built-in `http.server` plus no-cache headers, so an
edit always shows up on a normal refresh. Without it, browsers happily serve
a stale copy of `script.js` and it looks like your change did nothing.

## Deploying

A push to `main` is the deploy; GitHub Pages rebuilds in about 30 seconds.

**GitHub Pages sets roughly a ten-minute cache on the served files**, so the
build finishing does not mean your browser will show it. If a change is
definitely pushed but not visible on the live site, hard refresh
(`Ctrl+Shift+R`) rather than assuming the change failed. Locally this never
happens, because `serve.py` disables caching.

## Notes on how it's built

A few decisions worth calling out:

- **The timer derives from a wall-clock timestamp** rather than decrementing a
  counter. Browsers throttle background tabs aggressively, so a naive counter
  loses minutes while you read something in another tab — fatal for a study
  timer, and invisible in testing because testing means watching the tab.
- **The background is entirely static.** An earlier version animated four
  large blurred shapes, which re-blurred roughly two million pixels per frame
  and made the whole page feel laggy. Static blurs are rasterised once, which
  is what allows the current organic shapes to exist at all.
- **All colour and typography lives in CSS custom properties**, so the theme
  and font pickers are a few lines that rewrite variables rather than
  reaching into individual rules.
- **State is separated from rendering.** Each feature keeps its data in one
  place and has a single function that draws it; nothing else touches the DOM.
  It's the idea behind React, without React.

## Structure

```
index.html     markup
style.css      all styling, design tokens at the top
script.js      all behaviour, organised by feature
serve.py       local dev server with caching disabled
assets/sounds  ambient MP3s
IDEAS.md       requirements and decisions, including what was ruled out
```

## Status

In progress. Still to come: Spotify playlist embeds, and a Google Calendar
widget for the day's events.

The games panel holds a picker, so a second game is a new card and its own
module rather than a restructure.
