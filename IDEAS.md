# Ideas & Requirements

A running list. Nothing here is a commitment to build — it's a place to park
wants so they don't get lost. Items move from here into the roadmap in README.

Legend: **[structural]** must influence how things are built · **[cosmetic]**
safe to add any time · **[open]** needs a decision · **[out]** ruled out

---

## Identity

- **[decided]** Name is **LockedIn**. Page title and tab clock use `LockedIn`;
  the on-screen wordmark is lowercase `lockedin` as a styling choice, mirroring
  Flocus's lowercase mark. Say the word to capitalise it.
- **[cosmetic]** Wordmark in the top-left, styled like Flocus's.

## Fonts

- Flocus uses **Degular Bold** for the timer, **Degular Semibold** for
  headings, and **Inter** for UI text. (Verified from the live site.)
- **Degular is a commercial font** from OH no Type Co. Not free, not on
  Google Fonts. Licences on ohnotype.co are priced at **$179 / $419 / $519**
  (checked 2026-09-08) - not the ~$50 previously guessed here. Judged not
  worth it for a free portfolio project, so the aim is the least-wrong free
  face rather than a match.
- Closest free candidates, all verified to actually load: **Onest** (widest,
  nearest to Degular's proportions), Gabarito, Bricolage Grotesque,
  Clash Display, Satoshi.
- **The square colon is solved independently of the font** - it is drawn as
  two CSS blocks sized in `em`, so any font gets Degular's boxed colon.
- **[structural — done]** `--timer-font` CSS variable already in place.
- **[cosmetic]** Font picker offers several free display faces to choose from
  by eye. Candidates: Outfit, Figtree, Plus Jakarta Sans, Poppins (Google);
  Switzer, General Sans, Cabinet Grotesk (Fontshare, free commercial use).
- Inter is free, so UI text can match Flocus exactly.

## Settings panel

Right-side panel, organised into tabs.

- **[structural]** Tabbed layout, extensible — more tabs will be added.
- **Theme tab** — theme selector. All themes free. No separate "ambient
  mode"; themes only.
- **Clock tab** — 12-hour / 24-hour toggle.
- **Timer tab** — mode selector (**Countdown** default / **Stopwatch** /
  **Pomodoro**), plus the Pomodoro **break durations**, set here and nowhere
  else.
- **Font picker** — a dropdown, in one of these tabs. (A dropdown is fine
  here; only the *mode* selectors must be sliders.)
- **Timezone tab** — dropdown to pick a timezone.

## Controls

- **[structural]** Mode selection uses a **segmented slider** — a row of
  options where a highlighted box *slides* to whichever you click. Explicitly
  **not** a dropdown. Will be reused in several places, so build it once as a
  shared component.

## Timer

- **Default duration is 30 minutes**, not 25.
- **[structural]** Three modes change the timer's state shape:
  - *Countdown* — set a duration, count to zero (default)
  - *Stopwatch* — count up from zero, no target
  - *Pomodoro* — focus/break cycle with rounds
- **[decided]** The Focus / Short Break / Long Break pills come **off the main
  screen entirely** and never return. Break lengths are configured in the
  Settings → Timer tab only. The main screen stays clock, timer, controls.
- **[open]** With the pills gone, where does the *countdown duration* get
  set? Options: Settings only, or click the big number to edit it inline.
- **[open]** When Pomodoro reaches a break it should announce it. User will
  decide how (sound / on-screen message / both) later.

## Clock

- **[structural]** 12/24-hour and timezone together mean rewriting the clock
  to use `Intl.DateTimeFormat` rather than raw `Date` methods.

## Sounds

- Ambient mixer, layerable, per-sound volume.
- **[removed]** White / pink / brown noise. Were generated in-browser with
  the Web Audio API; user didn't like them. The code is preserved in commit
  9fa42e0 if it's ever wanted back.
- User supplies the MPGs — free choice of sounds and filenames; the SOUNDS
  list gets rewritten to match whatever lands in assets/sounds/.

## Panels

- **[structural]** Sounds and Music share **one dock button**, like Flocus:
  a single panel with tabs (Sounds / Music). Reuse the tab component built
  for Settings in Step 5. Do this when Spotify lands.
- **[planned]** **Notepad** — free-text scratchpad, like Flocus's.
- **[planned]** **To-do list** — checkable tasks, like Flocus's.

## Music

- Spotify playlist embeds. User will supply the playlist links.
- Playlists must be public; listeners need to be logged into Spotify for
  full tracks rather than 30-second previews.

## Mini player

- **[done]** Pop-out timer via Document Picture-in-Picture. Confirmed working
  in Google Chrome (the user's browser). Chrome and Edge only; Firefox and
  Safari have not implemented the API, and the button explains itself there.

## Calendar

- **[later]** Google Calendar "today's events" widget via Sign in with Google.
  Unverified-app cap of 100 users accepted as fine for this project.
- **[out]** Notion Calendar — no public API, cannot be integrated.
- **[out]** Canvas LMS — API exists, but browser calls are blocked and
  per-user tokens would expose friends' whole accounts. If wanted later,
  subscribe the Canvas calendar feed into Google Calendar instead; that needs
  no code here.

## Accounts

- **[out]** No login. Settings persist in the browser.
