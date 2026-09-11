import { MqttClient } from "./mqtt.js";
import { elapsedMs, isRunning, renderHooks, setSessionState } from "./timer.js";
import { showToast } from "./toast.js";

/* ==========================================================================
   Live sync

   Shared sessions work with nothing in the middle, because the timer is a
   pure function of when it started and what time it is now. Both machines do
   the same subtraction and never need to speak.

   Pausing is not in that function. It is an event, happening after the link
   was made, and a link cannot carry an event that has not happened yet. So
   this is the one part of the feature that needs a channel, and this file is
   that channel and nothing else - open a session link with nobody hosting and
   everything still works exactly as before, on arithmetic alone.

   WHY NOT PEER TO PEER

   This was WebRTC first, which was the obvious choice and the wrong one.

   Two browsers connecting directly have to get through two home routers, and
   when neither will open a path the connection has to bounce off a relay.
   The free relay everybody points at is gone - it answers DNS and nothing
   else, and a candidate gathering test gets zero relay routes from it. So a
   direct connection worked perfectly between two tabs on one machine and
   failed between two actual houses, which is the only case that matters.

   Both sides dialling out to the same broker has no such failure. Outbound is
   the one thing every home router allows; there is no hole to punch, so there
   is nothing to punch through. It costs a few hundred milliseconds against a
   timer that ticks once a second.

   WHAT THE BROKER SEES

   A public MQTT broker, run by someone else for free. It carries two numbers
   - whether a timer is running and how far in it is - on a topic named by 64
   random bits. No account, nothing stored, and nothing in the payload worth
   reading. If the broker is down, sync is down, and a session falls back to
   the arithmetic it was built on.

   THE HOST IS THE CLOCK

   One direction only. The host broadcasts; guests apply. Nobody negotiates,
   which is why there is no conflict resolution here and no way for two
   machines to argue about the time.

   A guest who presses pause is not fought with - they leave. Snapping someone
   back after they pressed a button is hostile, and it is also the shape of
   bug that never stops: apply, which renders, which fires the hook, which
   sends, which applies.
   ========================================================================== */

/* Two, because these are other people's free servers and either may be down.
   The client falls through the list and keeps retrying. */
const BROKERS = [
  "wss://broker.emqx.io:8084/mqtt",
  "wss://broker.hivemq.com:8884/mqtt",
];

const TOPIC_PREFIX = "lockedin/";

// Pause and resume are instant, through the render hook. This is the floor
// for everything else: a reset, an edited duration, someone who just arrived.
const HEARTBEAT_MS = 2000;

// Guests say hello on this beat so the host can count them.
const HELLO_MS = 8000;

// A guest not heard from in this long has gone.
const GUEST_GONE_MS = 22000;

// Three missed heartbeats and the host is treated as gone. Long enough to
// ride out a reconnect, short enough to notice within a break.
const HOST_GONE_MS = 9000;

// Below this, two clocks are agreeing. Correcting for network latency alone
// would restart the ticker several times a minute to fix nothing anyone sees.
const DRIFT_MS = 1500;

const HOSTING_KEY = "lockedin-hosting";
const ID_KEY = "lockedin-channel-id";

const NAME_KEY = "lockedin-name";

let role = null; // null | "host" | "guest"
let client = null;
let topic = "";
let applying = false; // true while a guest is being moved by the host
let stateTimer = null; // host only: the clock
let helloTimer = null; // everyone: "still here"
let watchdog = null; // everyone: who has gone quiet
let hostWatch = null; // guests only: has the clock gone quiet
let lastHostAt = 0;
let myName = "";

/* Everyone in the room, keyed by the sender id in their messages - including
   us, added locally, because the channel does not echo our own traffic back.
   Value is { name, host, at }, where at is when we last heard from them. */
const roster = new Map();

const statusEl = document.getElementById("sync-status");
const peopleEl = document.getElementById("sync-people");
const nameEl = document.getElementById("sync-name");

/* Ours, decided here rather than by a server, because the share link carries
   it and the link is built the instant the button is clicked. */
export let myChannelId = "";

let myClientId = "";

function randomId(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += byte.toString(36).padStart(2, "0");
  return out;
}

function setStatus(text) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.hidden = !text;
}

/* --------------------------------------------------------------------------
   The line itself
   -------------------------------------------------------------------------- */

function openChannel(channelId, onMessage, onReady) {
  topic = TOPIC_PREFIX + channelId;
  client = new MqttClient(BROKERS, "lockedin-" + myClientId);
  client.onMessage = (_topic, text) => {
    let message = null;
    try {
      message = JSON.parse(text);
    } catch (error) {
      return; // Someone else's traffic, or a truncated frame. Not ours.
    }
    // Our own publishes come back to us; nothing here wants to hear itself.
    if (!message || message.from === myClientId) return;
    onMessage(message);
  };
  client.onConnect = () => {
    client.subscribe(topic);
    onReady();
  };
  client.onDrop = () => {
    if (role === "host") setStatus("Reconnecting...");
    else if (role === "guest") setStatus("Reconnecting...");
  };
  client.connect();
}

function publish(message) {
  if (!client) return;
  message.from = myClientId;
  client.publish(topic, JSON.stringify(message));
}

/* --------------------------------------------------------------------------
   Hosting
   -------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
   Who is here

   Everyone announces themselves on the same channel and everyone keeps the
   same list, so a guest can see the other guests rather than only the host
   seeing a count. The host is not special here - it is special about the
   clock, which is a different thing.
   -------------------------------------------------------------------------- */

function displayName(name) {
  const trimmed = (name || "").trim();
  return trimmed ? trimmed.slice(0, 24) : "Someone";
}

function sayHello() {
  publish({ t: "hi", name: myName, host: role === "host" });
}

function renderPeople() {
  if (!peopleEl) return;

  if (!role || roster.size === 0) {
    peopleEl.innerHTML = "";
    peopleEl.hidden = true;
    return;
  }

  /* Host first, then alphabetical. A list that reorders itself every time
     someone's heartbeat lands would be unreadable, so the sort never depends
     on when anyone was last heard. */
  const people = [...roster.entries()].sort((a, b) => {
    if (a[1].host !== b[1].host) return a[1].host ? -1 : 1;
    return displayName(a[1].name).localeCompare(displayName(b[1].name));
  });

  peopleEl.innerHTML = "";
  people.forEach(([id, person]) => {
    const row = document.createElement("div");
    row.className = "sync-person";

    const dot = document.createElement("span");
    dot.className = "sync-dot";
    row.append(dot);

    const name = document.createElement("span");
    name.className = "sync-name-text";
    name.textContent = displayName(person.name);
    row.append(name);

    if (person.host) {
      const tag = document.createElement("span");
      tag.className = "sync-tag";
      tag.textContent = "host";
      row.append(tag);
    }
    if (id === myClientId) {
      const tag = document.createElement("span");
      tag.className = "sync-tag sync-tag-you";
      tag.textContent = "you";
      row.append(tag);
    }

    peopleEl.append(row);
  });
  peopleEl.hidden = false;
}

function describeRoom() {
  if (!role) return;
  const others = roster.size - 1; // ourselves are in there too

  if (role === "host") {
    setStatus(
      others <= 0
        ? "Hosting - nobody has joined yet."
        : others === 1
        ? "1 person is studying with you. Your pauses reach them."
        : others + " people are studying with you. Your pauses reach them."
    );
  } else {
    setStatus(
      others <= 1
        ? "Synced. The host's pauses reach you."
        : "Synced with " + others + " others. The host's pauses reach you."
    );
  }
  renderPeople();
}

/* Anyone we have not heard from in a while has closed their tab. There is no
   goodbye message: a browser being shut does not get to send one, so silence
   has to be the signal or half the departures would go unnoticed. */
function pruneRoster() {
  const cutoff = Date.now() - GUEST_GONE_MS;
  let left = null;
  roster.forEach((person, id) => {
    if (id === myClientId) return;
    if (person.at < cutoff) {
      left = person;
      roster.delete(id);
    }
  });
  if (left) {
    showToast(displayName(left.name) + " left the session.");
    describeRoom();
  }
}

function noteHello(message) {
  const id = message.from;
  const known = roster.has(id);
  roster.set(id, {
    name: message.name,
    host: !!message.host,
    at: Date.now(),
  });
  if (!known) {
    showToast(displayName(message.name) + " joined the session.");
    // Answer straight away so they appear in our list and we in theirs,
    // rather than both waiting out a heartbeat.
    sayHello();
    if (role === "host") broadcastState();
  }
  describeRoom();
}

function enterRoom() {
  roster.clear();
  roster.set(myClientId, { name: myName, host: role === "host", at: Date.now() });
  describeRoom();
  if (!helloTimer) helloTimer = setInterval(sayHello, HELLO_MS);
  if (!watchdog) watchdog = setInterval(pruneRoster, 4000);
}

function broadcastState() {
  if (role !== "host") return;
  publish({ t: "state", running: isRunning, elapsed: elapsedMs() });
}

export function startHosting() {
  if (role) return;
  role = "host";

  try {
    sessionStorage.setItem(HOSTING_KEY, "1");
    sessionStorage.setItem(ID_KEY, myChannelId);
  } catch (error) {
    // Private mode. Hosting works; it just will not survive a refresh.
  }

  setStatus("Connecting...");

  openChannel(
    myChannelId,
    (message) => {
      if (message.t === "hi") noteHello(message);
    },
    () => {
      enterRoom();
      sayHello();
      broadcastState();
    }
  );

  if (!stateTimer) stateTimer = setInterval(broadcastState, HEARTBEAT_MS);
}

/* --------------------------------------------------------------------------
   Joining
   -------------------------------------------------------------------------- */

export function joinChannel(channelId) {
  if (role || !channelId) return;
  role = "guest";
  lastHostAt = Date.now(); // grace period before the watchdog can fire
  setStatus("Connecting...");

  openChannel(
    channelId,
    (message) => {
      if (message.t === "hi") {
        noteHello(message);
        return;
      }
      if (message.t !== "state") return;
      lastHostAt = Date.now();
      applyState(message);
      describeRoom();
    },
    () => {
      enterRoom();
      sayHello();
    }
  );

  /* Separate from the roster prune: a host who goes quiet is a different
     event from a guest who does, because the clock stops being anyone's. */
  if (!hostWatch) {
    hostWatch = setInterval(() => {
      if (role !== "guest") return;
      if (Date.now() - lastHostAt < HOST_GONE_MS) return;
      setStatus("The host is not online - your timer runs on the link alone.");
    }, 3000);
  }
}

function applyState(message) {
  if (role !== "guest") return;

  const drift = Math.abs(message.elapsed - elapsedMs());
  if (message.running === isRunning && drift < DRIFT_MS) return;

  /* The flag is what stops this becoming a loop. setSessionState renders,
     rendering fires the hook below, and without this the hook would read a
     change it caused itself and treat it as the guest reaching for pause. */
  applying = true;
  try {
    setSessionState(message.elapsed, message.running);
  } finally {
    applying = false;
  }
}

function leaveSession() {
  role = null;
  [stateTimer, helloTimer, watchdog, hostWatch].forEach(clearInterval);
  stateTimer = helloTimer = watchdog = hostWatch = null;
  roster.clear();
  renderPeople();
  if (client) {
    client.close();
    client = null;
  }
  setStatus("You left the shared session - this timer is yours now.");
  showToast("You took control of your own timer. The host no longer moves it.");
}

/* --------------------------------------------------------------------------
   Wiring
   -------------------------------------------------------------------------- */

export function initSync() {
  let stored = null;
  try {
    stored = sessionStorage.getItem(ID_KEY);
  } catch (error) {
    // Private mode; a fresh id is fine.
  }
  myChannelId = stored || randomId(8);
  myClientId = randomId(6);

  /* Kept here rather than in storage.js, which owns the settings blob. This
     is not a setting - it is only ever sent, never applied to the page. */
  try {
    myName = localStorage.getItem(NAME_KEY) || "";
  } catch (error) {
    myName = "";
  }

  if (nameEl) {
    nameEl.value = myName;
    nameEl.addEventListener("input", () => {
      myName = nameEl.value.slice(0, 24);
      try {
        localStorage.setItem(NAME_KEY, myName);
      } catch (error) {
        // Private mode; the name just will not outlive the tab.
      }
      const me = roster.get(myClientId);
      if (me) me.name = myName;
      renderPeople();
      // Tell the room now rather than on the next beat, so a name being
      // typed shows up while the person is still looking at the panel.
      if (role) sayHello();
    });
  }

  let wasRunning = isRunning;

  renderHooks.push(() => {
    if (isRunning === wasRunning) return;
    wasRunning = isRunning;

    if (role === "host") {
      broadcastState();
      return;
    }

    /* A guest whose running state changed while we were not the ones changing
       it reached for the button themselves. That is a decision, not a
       desync. */
    if (role === "guest" && !applying) leaveSession();
  });

  /* A refresh should not silently stop hosting - the link is out there and
     people may already be holding it. */
  let wasHosting = null;
  try {
    wasHosting = sessionStorage.getItem(HOSTING_KEY);
  } catch (error) {
    // Private mode.
  }
  if (wasHosting === "1" && !new URLSearchParams(location.search).get("p")) {
    startHosting();
  }
}
