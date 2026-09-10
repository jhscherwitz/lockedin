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
- **Study together** — copy a session link and whoever opens it gets the same
  timer already running, in sync to the second. Pause or resume and it reaches
  them too. No account and no server; see
  [Studying with other people](#studying-with-other-people)
- **Discord Rich Presence** — `python presence.py 25/5` puts
  "Focus · round 2 / 23:41 left" on your profile; hand it a session link
  instead and it also gets a button that drops a friend into that same session
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
- **Today's Google Calendar events** in their own panel — read-only,
  browser-only, no backend and no server to trust. The app is published
  unverified, so anyone can connect - Google shows a warning screen first,
  and there is a lifetime cap of 100 accounts
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

## Studying with other people

### The session link

Settings → Timer → **Copy session link**. Send it to anyone. They open it and
land in your session already in progress — if you are nineteen minutes into
round 3, so are they.

This works because of a decision made long before anyone thought about sharing:
the timer never counted down, it subtracts a start timestamp from the clock.
That is what kept it accurate in a backgrounded tab, and the unplanned
consequence is that two computers handed the same start time compute the same
remaining time forever without ever talking to each other. So the link *is* the
synchronisation — it carries when the session began and how long its phases
are, and both browsers do the same arithmetic. There is nothing to host.

Joining does not overwrite your own timer settings. You run the host's lengths
while you are there, and your own come back afterwards — otherwise opening a
friend's 50-minute link would quietly replace your 25 and you would never work
out why.

The one thing it cannot do is fix a wrong clock. If a device is a minute out,
that person is a minute out; there is no authority here to correct against.

### Pausing together

Pause or resume, and everyone who opened your link does too.

That part cannot work on arithmetic alone. A pause is an *event*, happening
after the link was made, and a link cannot carry an event that has not happened
yet — so this is the one piece that needs a live channel. It uses WebRTC
through PeerJS: the browsers talk **directly**, and a free public server is used
only to introduce them, never seeing the timer. Nothing is stored and no account
exists.

The host is the clock. It broadcasts, guests apply, and nobody negotiates —
which is why there is no conflict resolution anywhere in `sync.js`. Measured
across two machines, the two timers agreed to **3 milliseconds**.

A guest who presses pause is not fought with; they **leave** the shared session
and keep their own time. Snapping someone back after they pressed a button is
hostile, and it is also the shape of bug that never ends — apply, which renders,
which fires the hook, which sends, which applies.

What it costs, plainly:

- **The host's tab is the session.** Close it and everyone else is told, and
  carries on alone. A refresh is fine — hosting resumes on the same id, so links
  already sent keep working.
- **A strict network can refuse a direct connection**, and the introduction
  service is someone else's free server, so it can be slow or down.

None of that loses you the timer. Sync failing drops you back to a plain shared
session, which is exactly what the link was before any of this existed — and a
link with the `&p=` trimmed off still works perfectly. The 85KB peer library is
fetched only when you actually share or join; ordinary visitors never download
it.

### Discord Rich Presence

```bash
python presence.py 25/5
```

`50` is fifty minutes of focus; `25/5` is a Pomodoro, cycling rounds and breaks
exactly as the site does; `25/5/15/4` sets the long break and the rounds before
it. A session link works too:

```bash
python presence.py "<paste your session link>"
```

The link is worth the extra step for two things a duration cannot do: it picks
up a session **already in progress** at the right point, and it is what puts the
**Study with me** button on your profile — a button needs somewhere to point.
Quote it, or the shell will cut it at the first `&`.

**Do this first: Discord → Settings → Activity Privacy → "Share your detected
activities with others", on.** It is the only step that fails silently — with
it off the script connects, Discord accepts the activity, no error appears
anywhere, and your profile shows nothing.

Then create an application at
[discord.com/developers/applications](https://discord.com/developers/applications)
(first visit shows a questionnaire — click Skip, New Application is behind it),
copy its **Application ID**, and paste it in when the script asks. It is
remembered in `presence-config.json`. Nothing needs approving. Full
instructions, including the optional artwork, are in the docstring at the top
of `presence.py`.

Leave the terminal window open while you study. Closing it or pressing Ctrl+C
clears the status, by design — a presence that outlived the session would be
worse than none.

It needs no `pip install`; like `serve.py` it is standard library only.

**Why a script and not part of the site.** Rich Presence is set over a local
pipe to the Discord desktop app, and a web page cannot open a pipe. Discord
does expose a WebSocket transport a browser could reach, but it is shut three
separate ways: the RPC API is closed to unapproved apps, every command over it
must first authenticate with an OAuth token, and obtaining that token needs a
client secret on a server. This site is static files on GitHub Pages. Any one
of the three would be enough on its own.

The script never asks the page what the timer is doing — it cannot, and it does
not need to. Given the same start timestamp it derives the phase itself, the
same trick the share link uses. `phase_at()` in `presence.py` is a
line-for-line port of `phaseAt()` in `src/timer.js` and has to stay that way.
It then hands Discord the moment the phase ends and Discord runs the countdown
itself, so the script sets your presence once per phase and then goes quiet.

### Why there is no Discord Activity

An Activity — the site running in a window inside a voice channel — was
investigated and deliberately not built. Discord sandboxes an Activity behind a
proxy where every external URL is blocked by CSP unless individually mapped,
which would cost the Spotify and Google Calendar panels outright. That would be
a worthwhile trade if the payoff were syncing everyone in the channel, but the
Embedded App SDK gives participants no way to share state without a backend,
and this project has no server. So a serverless Activity would be a smaller
LockedIn, missing two panels, that *still* could not sync anyone — strictly
worse than pasting the session link into the channel, which already works.

Worth revisiting only if the site ever grows a backend.

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
presence.py     Discord Rich Presence; run it yourself, talks to the desktop app
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
  session.js    shared session links: read one on load, build one to share
  sync.js       the live half: pause and resume, peer to peer
  vendor/       anime.js and peerjs, neither installed nor built
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
