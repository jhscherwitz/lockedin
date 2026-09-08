# Ambient sound files

MP3s the mixer plays. Each is looked up by filename from the `SOUNDS` list
near the top of the sounds section in `script.js`.

| File | Tile | Length | Size |
|---|---|---|---|
| `light-rain.mp3` | Light Rain | 1:44 | 3.3 MB |
| `heavy-rain.mp3` | Heavy Rain | 1:49 | 3.5 MB |
| `ocean-waves.mp3` | Ocean Waves | 1:11 | 2.3 MB |
| `river.mp3` | River | 0:22 | 0.7 MB |
| `underwater.mp3` | Underwater | 0:07 | 0.15 MB |
| `forest-ambience.mp3` | Forest | 3:33 | 6.8 MB |
| `campfire.mp3` | Campfire | 2:20 | 4.5 MB |

Roughly 21 MB total. Files are only downloaded when a tile is switched on —
startup just reads each file's metadata to check it exists — so this does
not slow the initial page load.

## Notes

- `underwater.mp3` is only 7 seconds, so its loop repeats about nine times a
  minute and is audible as a loop. Worth replacing with something longer.
- `river.mp3` at 22 seconds is borderline for the same reason.
- Most files are encoded around 256 kbps. Ambient loops sound
  indistinguishable at 128 kbps, which would roughly halve the total size.

## Adding a sound

Add one entry to `SOUNDS` in `script.js` and drop a matching MP3 here. The
tile, its volume slider and the missing-file handling are all generated from
that list. Any tile whose file is absent greys out with a tooltip naming the
file it wants.
