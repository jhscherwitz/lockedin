# Word lists

Two files, both plain text, one word per line, lowercase, exactly five
letters. Fetched by the game the first time it is opened rather than on page
load, so they never delay the timer appearing.

| File | Words | Purpose |
|---|---|---|
| `answers.txt` | 1,186 | Words the game can choose as the answer |
| `guesses.txt` | 8,636 | Words the game will accept as a guess |

Both lists are needed. With only the answer list, real words get rejected and
the game feels broken. With no list at all, `aaaaa` is a legal guess.

Every answer is also in the guess list.

## Where they came from

- **Guesses** — five-letter entries from **ENABLE** (Enhanced North American
  Benchmark Lexicon), public domain, via
  [dolph/dictionary](https://github.com/dolph/dictionary).
- **Answers** — the intersection of ENABLE with
  [google-10000-english](https://github.com/first20hours/google-10000-english),
  which is ordered by frequency. Frequency decides which words are *common*;
  ENABLE decides which strings are *words*. Both gates are needed.

### Why the intersection, and not just frequency

The first version of this list used frequency alone, and the game served up
`cohen` as an answer. Frequency lists are built from web text, where names,
places and brands are extremely common — and once lowercased, a filter cannot
tell `italy` from `apple`. That list also contained `india`, `davis`, `tampa`,
`lloyd`, `diana` and `dover`.

ENABLE fixes it because it is a *dictionary*: it deliberately excludes proper
nouns. Words like `derby` and `jimmy` survive the filter, and correctly so —
a derby is a hat and a jimmy is a crowbar. They are ordinary nouns that happen
to also be names.

Deliberately *not* built from the New York Times' curated Wordle answer list.
A dictionary is a list of facts; their hand-picked selection is editorial work
that belongs to them.

## Filtering

Answers are screened against a small blocklist so the game never reveals
something unpleasant as the answer. Guesses are not filtered — the player
typed those, and a guess is never displayed as the answer. The blocklist is
short and certainly not exhaustive; add to it in the build step if something
slips through.
