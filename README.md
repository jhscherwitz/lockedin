# LockedIn

**[Open it →](https://jhscherwitz.github.io/lockedin/)**

A single-page focus dashboard: a Pomodoro timer, layerable ambient sounds,
tasks and a notepad, on one calm screen.

Built with plain HTML, CSS and JavaScript — no framework, no build step, no
dependencies. Open the folder, run one command, and it works.

## Features

- **Timer with three modes** — countdown, stopwatch, and Pomodoro with
  configurable focus and break lengths and round tracking
- **It tells you when time is up** — a chime plus an optional browser
  notification, both scheduled so they land on time even in a background tab
- **Your own sounds** — drop an MP3 in `assets/alerts/` for the session end
  or for beating a game, and it is level-matched and used automatically
- **Pop-out mini timer** — a real always-on-top window (Document
  Picture-in-Picture) so the countdown stays visible while you work elsewhere
- **Ambient sound mixer** — seven recordings, any number playing at once,
  each with its own volume plus a master
- **Tasks and a notepad** — edited in place, saved automatically
- **Eight games for breaks** — Wordle (words), Blackjack, Minesweeper,
  Sequence (pattern memory), Snake, Dino Run, Sudoku with generated puzzles,
  and 2048. Sudoku, Snake, Wordle and Minesweeper can be won, and say so.
- **Spotify playlists**, built-in plus your own, loaded only when you pick one
- **Today's Google Calendar events** in the Notes & Tasks panel — read-only,
  browser-only, no backend and no server to trust
- **Nine themes that are actually different** — each sets its own shape
  layout, blur, grain, vignette and text warmth, not just a palette. Noir
  drops the blur to 26px so the shapes have visible edges; Midnight uses
  three huge soft masses and a heavy vignette; Ember and Tide replace the
  background composition outright; Paper is a full daylight inversion
- **Fonts, 12/24-hour clock, and full timezone support**
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
- **The end-of-session chime is booked on the audio clock, not played by the
  timer.** Same throttling problem as above, one step worse: a hidden tab's
  `setTimeout` can be held back by up to a minute, and an alarm that fires a
  minute late is worse than no alarm. The Web Audio clock runs on the audio
  thread, so the notes are scheduled the moment you press Start — an hour
  ahead if need be — and sound on time whatever the main thread is doing.
  Measured: with the main thread deliberately jammed for 1.2 seconds,
  `setInterval` fired zero times while the audio clock kept perfect time.
- **The background is entirely static.** An earlier version animated four
  large blurred shapes, which re-blurred roughly two million pixels per frame
  and made the whole page feel laggy. Static blurs are rasterised once, which
  is what allows the current organic shapes to exist at all.
- **All colour and typography lives in CSS custom properties**, so the font
  picker is a few lines that rewrite variables rather than reaching into
  individual rules.
- **The Google Calendar widget has no backend, and the client ID in the
  source is not a leak.** An OAuth *client* ID is an identifier, not a
  secret; what protects the account is the authorised-origin list on the
  client plus the consent screen. The client *secret* is the sensitive half,
  and a browser app never uses one. The access token lives in a variable and
  never touches localStorage — it is a credential, and storing it would only
  make it outlive the session for no benefit.
- **One surface scale, and it is what made a light theme possible.** Every
  translucent layer resolves from `--surface-1..4`, `--sunk-1..2`,
  `--line-soft/--line/--line-strong` and two shadows. Before that there were
  72 hardcoded `rgba()` values in the stylesheet, with the same "faintest
  lift" written as 0.05, 0.06, 0.065, 0.07, 0.08 *and* 0.085 — six spellings
  of one intention, and nothing central to flip. The tokens are named by role
  rather than by colour, because "surface" still means something when a theme
  inverts it and "white-10" does not: in Paper those values are black.
- **A theme is one attribute on `<html>`.** `applyTheme()` sets
  `data-theme="midnight"` and stops; every rule that cares keys off it in CSS.
  No JavaScript knows what a theme looks like, which is why adding one means
  writing a CSS block and a name in a list. It also lets a theme change the
  *composition* — where the shapes sit, how soft they are, how strong the
  grain and vignette are — rather than only recolouring it. Six themes that
  shared one layout came out as the same page under six filters.
- **State is separated from rendering.** Each feature keeps its data in one
  place and has a single function that draws it; nothing else touches the DOM.
  It's the idea behind React, without React.

## Structure

```
index.html      markup
style.css       all styling; design tokens and the surface scale at the top
serve.py        local dev server with caching disabled
assets/sounds   ambient MP3s
assets/alerts   your own end-of-session and game-win sounds
assets/words    Wordle answer and guess lists
IDEAS.md        requirements and decisions, including what was ruled out

src/main.js     entry point: imports every module, then starts them in order
src/
  audio.js      one AudioContext for the page
  clock.js      timezone and 12/24-hour settings, the live clock
  timer.js      the three modes, and the click-to-edit duration
  alerts.js     the chime, your MP3s, and browser notifications
  settings.js   the Timer tab, number inputs, the segmented control
  panels.js     opening and closing the five panels
  sounds.js     the ambient mixer
  appearance.js themes, fonts, timezone picker
  tasks.js      task rows and the notepad
  storage.js    save and restore; runs last on startup
  pip.js        the pop-out mini timer
  toast.js      the message strip
  keys.js       keyboard shortcuts
  calendar.js   today and tomorrow from Google Calendar
  music.js      Spotify embeds
  games/        shell.js plus one file per game
```

`src/` is loaded as native ES modules (`<script type="module">`), so there is
still no build step - but it does mean the page has to be served over HTTP.
Opening `index.html` straight off disk will not work; use `serve.py`.

## Status

Working and deployed. Everything on the original list is built.

## Notes on the module split

Worth recording, because the module system caught two real design problems
that a single file had been hiding.

**Modules define on load, and do when told.** The first attempt let each
module run its own setup at module scope. That broke immediately: the modules
genuinely import each other in circles - the timer needs the alarm, the alarm
needs the timer - and a circular import is fine right up until something
*executes* across the circle while the modules are still initialising.
`appearance.js` called `applyTheme()` at module scope, which called `render()`
in `timer.js`, which read a `const` that `timer.js` had not reached yet.
Setup now lives in `init*()` functions that `main.js` calls in order.

**An imported binding is read-only.** `storage.js` used to assign straight to
`masterVolume` and `tasks`, which are owned by other modules. In one file that
worked. As modules it is a `TypeError`, and rightly so - shared mutable state
should have exactly one place that writes it. The owners now export
`setMasterVolume()`, `setTasks()` and `clearBanked()`.
