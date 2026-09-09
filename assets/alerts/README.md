# Alert sounds

Two sound files live here.

| File | Plays when |
|---|---|
| `alarm-sound.mp3` | a timer session ends |
| `game-achievement.mp3` | you beat Sudoku, Snake, Wordle or Minesweeper |

Those exact names, in this folder. The page looks for them on load; anything
else it will not find. `chime.mp3` and `win.mp3` also work as alternates. If
you want to keep some other filename, say so — it is one line to add.

Both are optional and independent:

- `alarm-sound.mp3` is *the* end-of-session sound whenever it is present.
  There is no picker — the built-in synthesised chime is only the fallback
  for when the file is missing, so a renamed or deleted MP3 means a quieter
  alarm rather than no alarm.
- Without `game-achievement.mp3` winning a game is simply silent. There is no
  built-in fallback for that one.

Delete either file and the page copes on its own — nothing breaks.

## What makes a good one

| | |
|---|---|
| Length | 1–3 seconds. Longer reads as an event rather than a cue. |
| Shape | A one-shot — a single hit, not a loop. |
| Ending | It should decay to silence. A hard cut clicks every single time. |
| Content | No music bed, no voice. |
| Volume | Does not matter. See below. |

Volume is handled for you. Each file is scanned for its loudest sample and
gained so its peak matches the built-in chime, capped at 8x so a nearly
silent file is not amplified into hiss. Free sound libraries vary wildly in
level, and this is why that does not matter.

The two current files measure:

```
alarm-sound.mp3        4.15s   peak 0.413  ->  gain 1.82
game-achievement.mp3   1.96s   peak 0.617  ->  gain 1.22
```

## Which volume control each one answers to

The **timer** sound ignores the master volume slider in the Sounds panel.
That slider reads as the ambient mixer's volume, so letting it silence the
alarm would be a trap — turn the rain off and you would lose the one sound
you were relying on. It has its own switch in Settings → Timer instead.

The **game** sound does follow the master slider, because it is incidental
feedback like every other game sound. Turning that down is how you mute it.

## Where to get one

[Pixabay](https://pixabay.com/sound-effects/) is the safe default — its
licence allows commercial use with no attribution, the same licence the
ambient recordings in `assets/sounds/` use. This is a public repository with
a public URL, so the licence genuinely matters.

Search terms that work, roughly in order of hit rate:

- `meditation bell`, `singing bowl` — the most fitting for a focus timer
- `soft chime`, `notification bell`, `bell ding`
- `kalimba`, `glockenspiel`, `vibraphone`, `marimba notification` — warm and
  bell-like without sounding like an alarm
- `success`, `achievement`, `level up` — for the game win

Freesound also works but its licences vary file by file, so check each one.
Do not rip audio from YouTube: it breaks their terms, the audio is usually
someone's copyrighted work, and this repository is public.

## How they are played

Not through an `<audio>` element. Each file is decoded once into an audio
buffer and then *scheduled* on the Web Audio clock — for the timer, the
moment you press Start, an hour ahead if that is your session length.

That is deliberate. Browsers throttle timers in hidden tabs by up to a
minute, so anything triggered when the countdown reaches zero would arrive
late exactly when you are relying on it. The audio clock runs on the audio
thread and is not throttled. Your own file gets the same punctuality as the
built-in chime.
