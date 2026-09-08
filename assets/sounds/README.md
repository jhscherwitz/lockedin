# Ambient sound files

Drop MP3s here using these exact filenames — the app looks for them by name:

| File | Tile |
|---|---|
| `rain.mp3` | Rain |
| `ocean.mp3` | Ocean |
| `forest.mp3` | Forest |
| `cafe.mp3` | Café |
| `fireplace.mp3` | Fireplace |
| `thunder.mp3` | Thunder |

Any tile whose file is missing shows greyed out and can't be switched on.
Nothing breaks; it just stays disabled until the file appears.

White, pink and brown noise need no files. They're generated in the browser.

## Picking files

- **MP3**, seamlessly looping (search for "loop" — an audible seam is
  unbearable after 40 minutes)
- 30 seconds to 2 minutes, under about 2 MB each
- **CC0 / public domain** licensing. Pixabay is the easy option: free, no
  attribution required, safe for a public project.

## Adding a new sound

Add one entry to the `SOUNDS` list at the top of the sounds section in
`script.js`, then drop a matching MP3 in here. Nothing else to change.
