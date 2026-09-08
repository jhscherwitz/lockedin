# Word lists

Two files, both plain text, one word per line, lowercase, exactly five
letters. Fetched by the game the first time it is opened rather than on page
load, so they never delay the timer appearing.

| File | Words | Purpose |
|---|---|---|
| `answers.txt` | 1,323 | Words the game can choose as the answer |
| `guesses.txt` | 15,921 | Words the game will accept as a guess |

Both lists are needed. With only the answer list, real words get rejected and
the game feels broken. With no list at all, `aaaaa` is a legal guess.

Every answer is also in the guess list.

## Where they came from

- **Answers** — five-letter entries from
  [google-10000-english](https://github.com/first20hours/google-10000-english),
  which is ordered by frequency in Google's word corpus. Frequency ordering is
  the point: a raw dictionary filtered to five letters is full of words like
  `aalii`, which would be miserable as answers.
- **Guesses** — five-letter entries from
  [dwyl/english-words](https://github.com/dwyl/english-words) (Unlicense),
  filtered to A–Z only.

Deliberately *not* built from the New York Times' curated Wordle answer list.
A dictionary is a list of facts; their hand-picked selection is editorial work
that belongs to them.

## Filtering

Answers are screened against a small blocklist so the game never reveals
something unpleasant as the answer. Guesses are not filtered — the player
typed those, and a guess is never displayed as the answer. The blocklist is
short and certainly not exhaustive; add to it in the build step if something
slips through.
