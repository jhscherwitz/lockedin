# Ambient sound files

Drop MP3s in this folder. The app looks them up by filename.

The names don't have to match anything in particular — pick whatever sounds
you want, name the files sensibly, and the `SOUNDS` list near the top of the
sounds section in `script.js` gets updated to match. Any tile whose file is
missing shows greyed out with a tooltip saying which file it wants, so a
mismatch is obvious rather than silent.

Current expected names:

| File | Tile |
|---|---|
| `rain.mp3` | Rain |
| `ocean.mp3` | Ocean |
| `forest.mp3` | Forest |
| `cafe.mp3` | Café |
| `fireplace.mp3` | Fireplace |
| `thunder.mp3` | Thunder |

## Picking files

- **MP3**, seamlessly looping — search for "loop". A seam you can't hear in
  a 10-second preview is unbearable at minute 40.
- 30 seconds to 2 minutes, under about 2 MB each.
- **CC0 / public domain.** This project is public and carries your name.
  Pixabay is the easy option: free, no attribution, has a loop filter.
  Freesound is bigger but licences vary per file, so check each one.

## Adding a sound

Add one entry to `SOUNDS` in `script.js` and drop a matching MP3 here.
Nothing else changes — the tile, its volume slider and the missing-file
handling are all generated from that list.
