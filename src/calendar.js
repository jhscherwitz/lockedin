import { clockSettings } from "./clock.js";
import { MINUTE } from "./timer.js";

/* ==========================================================================
   Google Calendar - today's events

   Read-only, browser-only, no backend. Google Identity Services hands the
   page an access token; the page calls the Calendar REST API with it.

   The client ID below is public on purpose. An OAuth *client ID* is an
   identifier, not a secret - it is safe in a public repository, which is why
   this works with no server. What protects the account is the authorised
   origin list on the client (localhost:8000 and jhscherwitz.github.io) plus
   the consent screen. The client *secret* is the sensitive half, and a
   browser app never uses it.

   The app is in Google's "Testing" publishing status, which caps it at 100
   hand-added test users and shows them an "unverified app" warning. That is
   a deliberate trade: verification means a review process, and this is a
   personal project.
   ========================================================================== */

const CAL_CLIENT_ID =
  "338831087614-9apur9f4o4krq8o737nl0ntjffte9l5a.apps.googleusercontent.com";
const CAL_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const CAL_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

const calBody = document.getElementById("calendar-body");

/* The token is held in memory and nowhere else. It is a credential, so it
   does not go in localStorage - anything with access to the page could read
   it there, and it would outlive the session for no benefit. Losing it on
   reload costs one click. */
let calToken = null;
let calTokenExpires = 0;
let calTokenClient = null;

let calEvents = null; // null = never loaded, [] = loaded and empty
let calLoadedAt = 0; // for the staleness check when the tab is reopened
let calRange = null; // the two dates the loaded events were grouped against
let calStatus = "idle"; // idle | loading | ready | error
let calError = "";

function calTokenValid() {
  // 30s of slack, so a request cannot start with a token that expires mid-flight.
  return calToken !== null && Date.now() < calTokenExpires - 30000;
}

/* A zone's current distance from UTC, as "-05:00" or "Z", read out of Intl
   rather than hardcoded anywhere. */
function calZoneOffset(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(instant);
  const name = parts.find((part) => part.type === "timeZoneName").value;

  // "GMT-05:00", or a bare "GMT" for UTC itself.
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!match) return "Z";
  return match[1] + match[2] + ":" + (match[3] || "00");
}

/* The window runs from midnight today to midnight after tomorrow, in the
   clock's timezone rather than the browser's - someone who set the clock to
   another zone meant it.

   The bounds must be complete RFC3339 instants - "2026-09-09T00:00:00" on its
   own is rejected with a flat 400. The `timeZone` parameter does NOT rescue
   it: that only controls the zone times are returned in, not the zone timeMin
   is read in. So the offset is derived and appended.

   It is read at midday rather than at midnight or right now, because on the
   one day a year a zone shifts, midday falls after the changeover in every
   zone that has one - so this is the offset covering most of the day. On that
   single day the window edge can be an hour out, which for a study dashboard
   beats re-deriving the offset per boundary. */
function calLocalDate(instant) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: clockSettings.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type) => parts.find((part) => part.type === type).value;
  return get("year") + "-" + get("month") + "-" + get("day");
}

function calRangeBounds() {
  const today = calLocalDate(new Date());

  /* Date arithmetic done at noon UTC so adding a day cannot land on the
     wrong side of a midnight or a DST hour. */
  const next = new Date(today + "T12:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  const tomorrow = next.toISOString().slice(0, 10);

  return {
    today: today,
    tomorrow: tomorrow,
    timeMin: today + "T00:00:00" + calZoneOffset(new Date(today + "T12:00:00Z"), clockSettings.timeZone),
    timeMax: tomorrow + "T23:59:59" + calZoneOffset(next, clockSettings.timeZone),
  };
}

/* Which of the two days an event belongs under.

   All-day events carry `date`; timed ones carry `dateTime` and have to be
   converted into the clock's zone first, or an 11pm event lands on the wrong
   day for anyone whose calendar zone differs from their clock.

   The clamp matters: a multi-day all-day event that began last week has a
   start date before today, so bucketing on the raw value would drop it out of
   both groups and it would silently vanish from a day it is genuinely on. */
function calEventDay(event, range) {
  const raw = event.start && event.start.dateTime
    ? calLocalDate(new Date(event.start.dateTime))
    : (event.start && event.start.date) || range.today;

  if (raw <= range.today) return range.today;
  if (raw === range.tomorrow) return range.tomorrow;
  return null; // outside the window; should not happen, but do not guess
}

function calFormatTime(iso) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: clockSettings.hour12,
    hourCycle: clockSettings.hour12 ? undefined : "h23",
    timeZone: clockSettings.timeZone,
  });
  return formatter.format(new Date(iso));
}

/* ---- Connecting ---- */

function calGisReady() {
  return typeof google !== "undefined" && google.accounts && google.accounts.oauth2;
}

function calEnsureTokenClient() {
  if (calTokenClient || !calGisReady()) return calTokenClient;

  calTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CAL_CLIENT_ID,
    scope: CAL_SCOPE,
    callback: (response) => {
      if (response.error || !response.access_token) {
        calStatus = "error";
        /* Google returns access_denied for two quite different things: you
           pressed Cancel, and Google refused before you got the chance -
           which is what happens on the "unverified app" screen if you back
           out rather than clicking through Advanced. Saying "you declined"
           to someone who was blocked is just confusing, so the wording has
           to cover both without guessing which it was. */
        calError =
          response.error === "access_denied"
            ? "Google did not grant access. If you cancelled, try again. If you saw an “unverified app” warning, choose Advanced and continue - this is a personal project, so Google has not reviewed it."
            : "Google would not hand over a token. Try connecting again.";
        renderCalendar();
        return;
      }
      calToken = response.access_token;
      // expires_in is seconds; Google's is typically 3600.
      calTokenExpires = Date.now() + (Number(response.expires_in) || 3600) * 1000;
      loadCalendar();
    },

    /* Separate from `callback` on purpose, and easy to miss: the callback
       above never fires if the popup is closed or blocked. Without this the
       panel sits on "Loading today's events..." forever, and the only way out
       is a reload. */
    error_callback: (error) => {
      calStatus = "idle";
      calError = "";
      if (error && error.type === "popup_failed_to_open") {
        calStatus = "error";
        calError = "The browser blocked Google's sign-in popup. Allow popups for this site, then try again.";
      }
      renderCalendar();
    },
  });
  return calTokenClient;
}

function connectCalendar() {
  const client = calEnsureTokenClient();
  if (!client) {
    calStatus = "error";
    calError = "Google's sign-in script did not load. Check the connection and reload.";
    renderCalendar();
    return;
  }
  calStatus = "loading";
  renderCalendar();
  // Must be called from a click - it opens a popup, and browsers block
  // popups that no gesture asked for.
  client.requestAccessToken();
}

function disconnectCalendar() {
  /* Revoking matters. Without it the grant stays on the Google account even
     though the page has forgotten the token, so "Disconnect" would be a lie -
     one click would silently reconnect with no consent screen. */
  if (calToken && calGisReady() && google.accounts.oauth2.revoke) {
    google.accounts.oauth2.revoke(calToken, () => {});
  }
  calToken = null;
  calTokenExpires = 0;
  calEvents = null;
  calStatus = "idle";
  calError = "";
  renderCalendar();
}

/* ---- Loading ---- */

async function loadCalendar() {
  if (!calTokenValid()) {
    connectCalendar();
    return;
  }

  calStatus = "loading";
  renderCalendar();

  const range = calRangeBounds();
  const url =
    CAL_API +
    "?" +
    new URLSearchParams({
      timeMin: range.timeMin,
      timeMax: range.timeMax,
      timeZone: clockSettings.timeZone,
      // Expands recurring events into their individual occurrences, which is
      // the only way a named day means anything.
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "40",
    });

  try {
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + calToken },
    });

    if (response.status === 401) {
      // Token died early. Drop it and ask for another.
      calToken = null;
      calTokenExpires = 0;
      connectCalendar();
      return;
    }

    if (!response.ok) {
      throw new Error("Calendar API returned " + response.status);
    }

    const data = await response.json();
    calEvents = (data.items || []).filter((item) => item.status !== "cancelled");
    calRange = range;
    calStatus = "ready";
    calError = "";
    calLoadedAt = Date.now();
  } catch (error) {
    calStatus = "error";
    calError = "Could not reach Google Calendar. " + error.message;
  }

  renderCalendar();
}

/* ---- Drawing ----

   Same state-then-redraw shape as every other feature here: change calStatus
   or calEvents, then call renderCalendar() and let it work out the markup.

   Every piece of event text goes in with textContent, never innerHTML. Event
   titles come from other people - anyone who can put an event on your
   calendar writes that string - so treating it as markup would be handing
   them a script tag on your page. Same rule the task list follows. */

function calRow(event) {
  const row = document.createElement("li");
  row.className = "cal-event";

  const when = document.createElement("span");
  when.className = "cal-when";

  // An all-day event has `date` instead of `dateTime`.
  if (event.start && event.start.dateTime) {
    when.textContent = calFormatTime(event.start.dateTime);
  } else {
    when.textContent = "All day";
    row.classList.add("is-allday");
  }

  const title = document.createElement("span");
  title.className = "cal-title";
  title.textContent = event.summary || "(no title)";

  row.append(when, title);

  if (event.location) {
    const where = document.createElement("span");
    where.className = "cal-where";
    where.textContent = event.location;
    row.append(where);
  }

  return row;
}

function calButton(label, onClick, primary) {
  const button = document.createElement("button");
  button.type = "button";
  // A bare .btn has no surface of its own; ghost is the secondary style.
  button.className = primary ? "btn btn-primary" : "btn btn-ghost";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function calNote(text) {
  const note = document.createElement("p");
  note.className = "cal-note";
  note.textContent = text;
  return note;
}

function renderCalendar() {
  if (!calBody) return;
  calBody.innerHTML = "";

  if (calStatus === "loading") {
    calBody.append(calNote("Loading your calendar..."));
    return;
  }

  if (calStatus === "error") {
    calBody.append(calNote(calError));
    calBody.append(calButton("Try again", connectCalendar, true));
    return;
  }

  if (calStatus === "idle" || calEvents === null) {
    calBody.append(
      calNote(
        "Connect your Google Calendar to see today and tomorrow here. Read-only, and nothing is stored."
      )
    );
    calBody.append(calButton("Connect Google Calendar", connectCalendar, true));
    return;
  }

  if (calEvents.length === 0) {
    calBody.append(calNote("Nothing on the calendar today or tomorrow."));
  } else {
    const range = calRange || calRangeBounds();
    const days = [
      { label: "Today", key: range.today },
      { label: "Tomorrow", key: range.tomorrow },
    ];

    days.forEach((day) => {
      const heading = document.createElement("h3");
      heading.className = "cal-day";
      heading.textContent = day.label;
      calBody.append(heading);

      const forDay = calEvents.filter(
        (event) => calEventDay(event, range) === day.key
      );

      if (forDay.length === 0) {
        calBody.append(calNote("Nothing scheduled."));
        return;
      }

      const list = document.createElement("ul");
      list.className = "cal-list";
      forDay.forEach((event) => list.append(calRow(event)));
      calBody.append(list);
    });
  }

  const actions = document.createElement("div");
  actions.className = "cal-actions";
  actions.append(calButton("Refresh", loadCalendar));
  actions.append(calButton("Disconnect", disconnectCalendar));
  calBody.append(actions);
}


/* Refresh on opening the tab, but only if what is shown has gone stale -
   reopening the panel twice in a minute should not re-hit the API. */
const CAL_STALE_MS = 5 * MINUTE;


/* Called by main.js once every module has loaded. Doing this at module
   scope instead would run it while other modules were still initialising,
   which is how a circular import turns into a TDZ error. */
export function initCalendar() {
  renderCalendar();

  /* Refresh on opening, but only if what is on screen has gone stale -
     reopening twice in a minute should not re-hit the API.

     This watches the panel's own class rather than the dock button, because
     the panel can also be opened by a keyboard shortcut and closed by
     clicking away. The class is the thing that is always true. */
  const panel = document.querySelector('section.panel[data-panel="calendar"]');
  if (!panel) return;

  new MutationObserver(() => {
    if (!panel.classList.contains("is-open")) return;
    if (calStatus === "ready" && Date.now() - calLoadedAt > CAL_STALE_MS) loadCalendar();
  }).observe(panel, { attributes: true, attributeFilter: ["class"] });
}
