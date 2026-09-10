r"""Discord Rich Presence for a LockedIn session.

Shows "Focus - Round 2 / 23:41 left" on your Discord profile while you study,
with a button other people can click to join the same session, in sync.

    python presence.py 50           fifty minutes of focus, starting now
    python presence.py 25/5         Pomodoro: 25 on, 5 off, rounds and all
    python presence.py 25/5/15/4    ... long break, and rounds before it

    python presence.py "<session link>"

The link form is worth the extra step for two things a bare duration cannot
do: it picks up a session *already in progress* at the right point, and it is
what puts the "Study with me" button on your profile - a button needs
somewhere to point.

WHY THIS IS A SCRIPT AND NOT PART OF THE WEBSITE

Rich Presence is set by talking to the Discord desktop app over a local pipe -
on Windows, a named pipe called \\.\pipe\discord-ipc-0. A web page cannot open
a pipe. That is not a Discord restriction, it is the browser sandbox, and there
is no flag or permission that changes it.

Discord does offer a WebSocket transport a browser could reach, but it is shut
in three separate ways: the RPC API is closed to unapproved apps, every command
over it must first AUTHENTICATE with an OAuth access token, and getting that
token needs a client secret on a server. LockedIn is static files on GitHub
Pages. Any one of those three would be enough to stop it.

So the presence has to come from a program running on your own machine, and
this is that program.

HOW IT KNOWS WHAT THE TIMER IS DOING

It never asks. It cannot - there is no channel from the page to here.

It does not need one, for the same reason shared sessions work at all: the
timer does not count down, it subtracts a start timestamp from the clock. Hand
this script the same start timestamp and it computes the same remaining time
the page does, forever, without the two ever speaking. phase_at() below is a
line-for-line port of phaseAt() in src/timer.js, and it has to stay that way.

Then it hands Discord the moment the phase *ends*, and Discord runs the
countdown itself. So this sets your presence once per phase and then sits
quietly - no polling, nothing to keep in step, nothing to drift.

SETUP, ONCE

  1. In Discord: Settings -> Activity Privacy -> turn ON "Share your detected
     activities with others".

     This one first, because it is the only step that fails silently. With it
     off everything below still works perfectly - the script connects, Discord
     accepts the activity, no error appears anywhere - and your profile shows
     nothing at all. It cost an afternoon once already.

  2. Go to https://discord.com/developers/applications and click
     "New Application". Call it LockedIn - the name is what shows in bold on
     your profile, so this is the one part worth typing carefully.

     First visit shows a "What brings you to the Developer Portal?"
     questionnaire instead of your apps. Click Skip; New Application is behind
     it, top right.
  3. On that app's General Information page, copy the APPLICATION ID.
  4. Run this script. It asks for that ID the first time and remembers it in
     presence-config.json next to this file.

  Optional, for the artwork: on the app's "Rich Presence -> Art Assets" page,
  upload an image named exactly "lockedin". Without it the presence still
  works, it just has no picture.

  There is nothing to submit and nothing to be approved. Setting your own
  presence is the one thing Discord's local pipe allows with an application ID
  alone - no client secret, no OAuth, no review. Everything else over that pipe
  does need approval, which is why this script does only this.

Requires nothing installed - standard library only, like serve.py.
"""

import json
import os
import re
import socket
import struct
import sys
import time
import uuid
from urllib.parse import parse_qs, urlparse

MINUTE = 60000  # milliseconds, to match src/timer.js exactly

CONFIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "presence-config.json")

# Discord binds the first free one, so a second running client sits on -1.
PIPES = 10

OP_HANDSHAKE = 0
OP_FRAME = 1
OP_CLOSE = 2


# ---------------------------------------------------------------------------
# What you are studying to
#
# Two ways in. A duration is the short one and covers the common case - you
# want the status, and you do not care about anyone joining. A link is the
# exact one, because it carries a start time that may be in the past.
# ---------------------------------------------------------------------------

DURATION = re.compile(
    r"^(\d{1,3})(?:\s*/\s*(\d{1,3}))?(?:\s*/\s*(\d{1,3}))?(?:\s*/\s*(\d{1,3}))?$"
)


def read_timer(text):
    """A timer described directly: "50", "25/5", "25/5/15/4".

    Returns None when this is not a duration at all, so the caller can try
    reading it as a link instead. That is the whole dispatch - a thing is a
    duration or it is a URL, and they look nothing alike.
    """
    match = DURATION.match(text.strip())
    if not match:
        return None

    def part(index, low, high, fallback):
        raw = match.group(index)
        if raw is None:
            return fallback
        return max(low, min(high, int(raw)))

    return {
        # Now, necessarily. A bare duration has no way to say "twenty minutes
        # ago", which is exactly what the link form is for.
        "start": now_ms(),
        # One number is a plain stretch of focus. A pair is a Pomodoro: the
        # second number has nowhere else to be except a break.
        "mode": "pomodoro" if match.group(2) is not None else "countdown",
        "focus": part(1, 1, 600, 60),
        "short": part(2, 1, 60, 5),
        "long": part(3, 1, 60, 15),
        "rounds": part(4, 2, 10, 4),
        # No link means no button; activity_for() checks for https.
        "url": "",
    }


def read_session(raw):
    """Whichever of the two forms this is."""
    timer = read_timer(raw)
    if timer is not None:
        return timer
    return read_link(raw)


def read_link(url):
    """Pull a session out of a share link, or explain what is wrong with it.

    The validation mirrors readSharedSession() in src/session.js: sanity, not
    security. A garbage timestamp should be refused here rather than produce a
    presence claiming you have been studying since 1970.
    """
    query = parse_qs(urlparse(url).query)

    def one(name, fallback=None):
        got = query.get(name)
        return got[0] if got else fallback

    raw = one("s")
    if raw is None:
        raise ValueError(
            "That is neither a duration nor a session link.\n"
            "  A duration:  50   or   25/5   or   25/5/15/4\n"
            "  A link:      LockedIn -> Settings -> Timer -> Copy session link\n"
            "If you did paste a link, wrap it in quotes - the & in it will\n"
            "otherwise be eaten by the shell before Python ever sees it."
        )
    # Every link the site builds carries m and f alongside s. One with s but no
    # m did not arrive whole - almost always an unquoted paste, where the shell
    # cut it at the first &. Worth catching, because the defaults would
    # otherwise make it look like it worked and quietly show the wrong timer.
    if one("m") is None:
        raise ValueError(
            "That link is missing the settings that come after the &.\n"
            "It was almost certainly pasted without quotes - the shell cuts\n"
            "the link at the first &. Put it in \"double quotes\" and retry."
        )

    try:
        start = int(raw)
    except ValueError:
        raise ValueError("The ?s= in that link is not a number.")
    if start < 1600000000000:
        raise ValueError("The start time in that link is implausibly old.")
    if start > now_ms() + 5 * MINUTE:
        raise ValueError("That session starts in the future.")

    def minutes(name, low, high, fallback):
        try:
            value = int(one(name, fallback))
        except (TypeError, ValueError):
            return fallback
        return max(low, min(high, value))

    return {
        "start": start,
        "mode": "pomodoro" if one("m") == "pomodoro" else "countdown",
        "focus": minutes("f", 1, 600, 60),
        "short": minutes("b", 1, 60, 5),
        "long": minutes("l", 1, 60, 15),
        "rounds": minutes("r", 2, 10, 4),
        "url": url,
    }


def now_ms():
    return int(time.time() * 1000)


# ---------------------------------------------------------------------------
# Where the session is
#
# A port of phaseAt() in src/timer.js. It walks the cycle rather than deriving
# it arithmetically, for the same reason the original does: this way it cannot
# disagree with the page about where a long break falls.
# ---------------------------------------------------------------------------


def phase_at(elapsed, session):
    if session["mode"] != "pomodoro":
        return "focus", 1, elapsed

    left = elapsed
    at = "focus"
    n = 1

    for _ in range(20000):  # a guard, not a limit
        if at == "focus":
            length = session["focus"] * MINUTE
        elif at == "short":
            length = session["short"] * MINUTE
        else:
            length = session["long"] * MINUTE

        if left < length:
            return at, n, left
        left -= length

        if at == "focus":
            at = "long" if n % session["rounds"] == 0 else "short"
        else:
            at = "focus"
            n += 1

    return "focus", 1, 0


def phase_length(phase, session):
    if phase == "focus":
        return session["focus"] * MINUTE
    if phase == "short":
        return session["short"] * MINUTE
    return session["long"] * MINUTE


def describe(phase, round_number, session):
    """The two lines Discord shows under the app name."""
    if session["mode"] != "pomodoro":
        return "Focus", "%d-minute session" % session["focus"]
    if phase == "short":
        return "Short break", "Round %d of a %d/%d Pomodoro" % (
            round_number,
            session["focus"],
            session["short"],
        )
    if phase == "long":
        return "Long break", "After %d rounds" % session["rounds"]
    return "Focus - round %d" % round_number, "%d/%d Pomodoro" % (
        session["focus"],
        session["short"],
    )


# ---------------------------------------------------------------------------
# Talking to Discord
#
# The IPC protocol is small enough to write out: a little-endian opcode and
# length, then JSON. Writing it directly is what keeps this a standard-library
# script, and this project has no package manager to install a wrapper with.
# ---------------------------------------------------------------------------


class Discord:
    def __init__(self, client_id):
        self.client_id = str(client_id)
        self.handle = None
        self.is_socket = False

    def _paths(self):
        if os.name == "nt":
            return [r"\\.\pipe\discord-ipc-%d" % i for i in range(PIPES)]
        # Flatpak and Snap put it a level or two down from the runtime dir.
        base = (
            os.environ.get("XDG_RUNTIME_DIR")
            or os.environ.get("TMPDIR")
            or "/tmp"
        )
        roots = [base, os.path.join(base, "app", "com.discordapp.Discord"),
                 os.path.join(base, "snap.discord")]
        return [os.path.join(r, "discord-ipc-%d" % i)
                for r in roots for i in range(PIPES)]

    def connect(self):
        for path in self._paths():
            try:
                if os.name == "nt":
                    self.handle = open(path, "r+b", buffering=0)
                    self.is_socket = False
                else:
                    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                    sock.connect(path)
                    self.handle = sock
                    self.is_socket = True
            except (OSError, IOError):
                continue

            self._send(OP_HANDSHAKE, {"v": 1, "client_id": self.client_id})
            _, reply = self._recv()
            if reply.get("evt") == "READY":
                user = reply.get("data", {}).get("user", {})
                return user.get("username") or "Discord"
            # Connected but refused - almost always a wrong application ID.
            raise RuntimeError(
                "Discord refused that application ID. Check it against the\n"
                "APPLICATION ID on your app's General Information page.\n"
                "Delete presence-config.json to be asked for it again."
            )

        raise RuntimeError(
            "Could not find Discord running on this machine.\n"
            "Open the Discord desktop app and try again - the browser version\n"
            "cannot do this, because there is no pipe for it to listen on."
        )

    def _write(self, data):
        if self.is_socket:
            self.handle.sendall(data)
        else:
            self.handle.write(data)

    def _read(self, count):
        chunks = b""
        while len(chunks) < count:
            part = (self.handle.recv(count - len(chunks)) if self.is_socket
                    else self.handle.read(count - len(chunks)))
            if not part:
                raise RuntimeError("Discord closed the connection.")
            chunks += part
        return chunks

    def _send(self, opcode, payload):
        body = json.dumps(payload).encode("utf-8")
        self._write(struct.pack("<II", opcode, len(body)) + body)

    def _recv(self):
        opcode, length = struct.unpack("<II", self._read(8))
        return opcode, json.loads(self._read(length).decode("utf-8"))

    def set_activity(self, activity):
        self._send(OP_FRAME, {
            "cmd": "SET_ACTIVITY",
            "nonce": str(uuid.uuid4()),
            "args": {"pid": os.getpid(), "activity": activity},
        })
        self._recv()

    def close(self):
        if not self.handle:
            return
        try:
            # Clearing it first: otherwise the presence lingers for a while
            # after this script stops, which is worse than showing nothing.
            self._send(OP_FRAME, {
                "cmd": "SET_ACTIVITY",
                "nonce": str(uuid.uuid4()),
                "args": {"pid": os.getpid()},
            })
            self._send(OP_CLOSE, {})
        except (OSError, IOError, RuntimeError, struct.error):
            pass
        try:
            self.handle.close()
        except (OSError, IOError):
            pass


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def client_id():
    if os.path.exists(CONFIG):
        try:
            with open(CONFIG, encoding="utf-8") as handle:
                saved = json.load(handle).get("client_id")
            if saved:
                return str(saved)
        except (ValueError, OSError):
            pass  # unreadable or hand-edited: just ask again

    print("First run. Paste the APPLICATION ID of your Discord app.")
    print("Create one at https://discord.com/developers/applications - it takes")
    print("a minute, needs no approval, and the ID is not a secret.")
    entered = input("Application ID: ").strip()
    if not entered.isdigit():
        raise SystemExit("That is not an application ID - it is all digits.")

    with open(CONFIG, "w", encoding="utf-8") as handle:
        json.dump({"client_id": entered}, handle, indent=2)
    print("Saved to presence-config.json.\n")
    return entered


# ---------------------------------------------------------------------------
# Running
# ---------------------------------------------------------------------------


def activity_for(session):
    """The presence for right now, or None once a countdown has run out."""
    elapsed = now_ms() - session["start"]

    if session["mode"] == "countdown" and elapsed >= session["focus"] * MINUTE:
        return None

    phase, round_number, offset = phase_at(elapsed, session)
    details, state = describe(phase, round_number, session)
    ends_at = now_ms() + (phase_length(phase, session) - offset)

    activity = {
        "details": details,
        "state": state,
        # Discord runs this countdown itself, which is why this script can set
        # the presence once per phase and then go quiet.
        "timestamps": {"start": session["start"] // 1000, "end": ends_at // 1000},
        "assets": {"large_image": "lockedin", "large_text": "LockedIn"},
    }

    # The payoff of the two features together: the link on your profile drops
    # whoever clicks it into this same session, already running, in sync.
    if session["url"].startswith("https://"):
        activity["buttons"] = [{"label": "Study with me", "url": session["url"]}]

    return activity


def run(session):
    discord = Discord(client_id())
    who = discord.connect()
    print("Connected to Discord as %s." % who)
    if not session["url"].startswith("https://"):
        print("Note: a localhost link cannot be a profile button - Discord only")
        print("takes https. The presence itself still works.")
    print("Press Ctrl+C to stop and clear it.\n")

    shown = None
    try:
        while True:
            activity = activity_for(session)
            if activity is None:
                print("That session has finished. Clearing presence.")
                return

            # Only on a real change: SET_ACTIVITY is rate limited, and there is
            # nothing to gain by resending an identical phase.
            key = (activity["details"], activity["state"])
            if key != shown:
                discord.set_activity(activity)
                shown = key
                left = activity["timestamps"]["end"] - int(time.time())
                print("%s  (%d:%02d left)" % (activity["details"],
                                              left // 60, left % 60))

            # Wake just after the phase turns over. Capped so that Ctrl+C stays
            # responsive and a dropped Discord gets noticed reasonably soon.
            until = activity["timestamps"]["end"] - time.time() + 1
            time.sleep(max(1.0, min(30.0, until)))
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        discord.close()


def main():
    if len(sys.argv) > 1:
        raw = sys.argv[1].strip()
    else:
        print(__doc__.strip().split("\n\n")[0])
        print()
        print("A duration - 50, or 25/5 - or a session link.")
        raw = input("> ").strip()

    if not raw:
        raise SystemExit("Nothing given. Try: python presence.py 25/5")

    try:
        session = read_session(raw)
    except ValueError as error:
        raise SystemExit(str(error))

    run(session)


if __name__ == "__main__":
    main()
