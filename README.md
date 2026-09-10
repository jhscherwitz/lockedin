# LockedIn

**[Open it →](https://jhscherwitz.github.io/lockedin/)**

A single-page focus dashboard: a Pomodoro timer, layerable ambient sounds,
tasks and a notepad, on one calm screen.

Built with plain HTML, CSS and JavaScript — no framework and no build step.
One dependency, Anime.js, which is vendored into `src/vendor/` as a file
rather than installed, so there is still no package manager and nothing is
fetched at runtime. Open the folder, run one command, and it works.

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
- **Nine games for breaks** — Wordle (words), Blackjack, Minesweeper, Repeat
  the Sequence (pattern memory), Snake, Dino Run, Sudoku with generated
  puzzles, 2048, and a Geometry Dash style one-button platformer with a
  designed level, ship sections and jump pads. Sudoku, Snake, Wordle,
  Minesweeper and Geometry Dash can be won, and say so.
- **Spotify playlists**, built-in plus your own, loaded only when you pick one
- **Today's Google Calendar events** in the Notes & Tasks panel — read-only,
  browser-only, no backend and no server to trust
- **Twelve themes that are actually different** — each sets its own shape
  layout, blur, grain, vignette and text warmth, not just a palette. Noir
  drops the blur to 26px so the shapes have visible edges; Midnight uses
  three huge soft masses and a heavy vignette; Ember and Tide replace the
  background composition outright; Neon is the only one that glows, with
  hard bright cores over soft halos; Paper and Glacier are full daylight
  inversions, one warm and one cold. Forest is the default: four masses and
  a direction, with the light entering from one corner
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
edit to HTML or CSS always shows up on a normal refresh. Without it, browsers
happily serve a stale copy and it looks like your change did nothing.

**JavaScript is the exception, and it will fool you.** Since `src/` became ES
modules, a normal refresh reuses the modules already in the tab's module map
regardless of what the response headers say. The CSS updates, the JS does
not, and you get a page running new styles against old code - which looks
like a bug in your change rather than a stale file. Use `Ctrl+Shift+R` after
editing anything under `src/`.

### Seeing the defaults: `?fresh`

Add `?fresh` to the URL - `http://localhost:8000/?fresh`, or the live site -
to load as a first-time visitor.

Saved state sits on top of every default, so a *changed* default is invisible
to anyone who has opened the page before, which is everyone testing it.
Changing the default theme looks exactly like changing nothing. This skips
the restore for one load so you can see what a new visitor sees.

**Nothing is written and nothing is deleted.** Every write is suppressed for
that load, including the one on `beforeunload`, so leaving the page cannot
overwrite your real settings with the defaults you were just looking at.
Drop the parameter and your theme, tasks, notes and volumes all come back
untouched. That is deliberate: a version that wiped storage would cost you
your notes every time you checked a default, so you would never use it.

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
- **The icons are Tabler, pasted in rather than installed.** They had been
  drawn by hand, which mostly worked, but two of them had drifted into each
  other: Sounds was an equaliser and Settings was a set of sliders, so two
  buttons in the same dock were five vertical bars with dots on them. The
  two icon sets also disagreed on stroke weight, 2 against 2.6, which is
  enough to stop them reading as one family. Tabler is MIT and draws on the
  same 24 grid at weight 2 with round caps that this project was already
  using, so adopting it meant copying path data and deleting a stylesheet
  line - no package, no build step, nothing at runtime. Sounds is a speaker
  now and Settings keeps the sliders.

- **An accent and the colour that goes on it are chosen together.** The
  primary button had used the body text colour over `--accent` since the
  beginning. Measured, that was 4.35:1 - under the 4.5:1 a 14px bold label
  needs. Checking all ten accents the same way turned up a second one in
  the same state: Aurora at 4.17/4.35 and Dawn at 4.08/3.96, both *failing
  against black and white simultaneously*. That is the interesting case,
  because it cannot be fixed by picking a different text colour; a mid-tone
  in that zone has no readable partner, and the only fix is to move the
  accent out of the zone. Both moved. Every theme now declares
  `--on-accent` next to `--accent`, with the measured ratio in a comment,
  so the pair is chosen once and together rather than assumed.

- **Three durations and two curves, for a page that does not animate.** The
  stylesheet had eleven transition durations - 0.08, 0.1, 0.12, 0.13, 0.15,
  0.18, 0.2, 0.22, 0.25, 0.3 - and almost nothing declared an easing, so
  most transitions ran on the browser default while a few ran on a
  cubic-bezier. Nothing about that was visible as a bug; it just meant
  hovering two different buttons felt like two different pages. It is now
  `--t-fast` for presses, `--t` for colour, `--t-slow` for things that
  travel, and the background is still painted once and cached.

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
