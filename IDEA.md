# IDEA.md

Open ideas, one or two sentences each.

Dropped or done, never to be re-proposed: the position scrubber (done as
`LoopRangeBar`), an automatic difficulty grade (rejected -- difficulty stays
user-assigned), MIDI file import (rejected -- MusicXML only), the note-naming and
note-to-key quizzes (done as the reading quiz's two answer modes), the
keyboard-free quizzes beyond those two, and the daily challenge and progression
ladder built on top of them.

## 1. Harvest MusicXML from PianoML

PianoML's library is not in its GitHub repo -- it is behind a public,
unauthenticated API at `https://api.pianoml.org` (8047 public-domain scores
against 4588 copyrighted). `tools/harvest-pianoml.mjs` (`npm run harvest`)
pulls a collection into `data/library/<collection>/` with clean in-file metadata
and an `index.json`, in three modes: one opus rebuilt in its own order, one
composer ordered by grade, or a whole grade band of two-hand classical scores
filtered on measurable defects. 457 beginner files are harvested
(`beginners-grade-1`, `beginners-grade-2`). What is still open is the last step:
getting a curated subset of them *into the catalog*, which today only accepts
uploads through the UI.

Worth knowing before extending it:

- `GET /score/search?keyword=&gradeStart=&gradeEnd=&offset=&limit=` caps at 50 per
  page; `GET /score/{ownerId}/{id}/musicxml/{version}/{revision}` is the download
  (the same path with a bare `{id}` is the upload route and answers 405 to a GET).
- **Titles and composers come from the API JSON, not from the files**: the
  downloads carry no `<work-title>` and no `<creator>` at all.
- **The engravings are MIDI-derived and mostly not quantized**: the converter
  kept bar lengths honest by changing the time signature every few measures (4/4,
  then 5/4, then 15/8), and there are no dynamics or articulations. The notes and
  their order are right, which is all `WaitEngine` needs, but 16 of the 25
  Burgmüller études read badly (`meterConsistency` in each `index.json`). A
  human-typeset source would beat this: `pnlong/PDMX` (a public-domain MusicXML
  dataset scraped from MuseScore) is the next one to try.
- Only the works are public domain; each engraving is somebody's upload, so
  `data/` (gitignored) is where they stay rather than this public repo.

## 2. Exercises more fun than Hanon

Hanon is dull, and `ExerciseKind` was built so another drill is a tab plus a
generator. Two directions, needing different work:

- **Burgmüller op. 100 is harvested**: all 25 études, in order, in
  `data/library/burgmuller-op-100/` (only 9 of them cleanly engraved, see idea 1),
  so what is left is choosing how the app presents a fixed ordered collection --
  a curated list, not a generator.
- **Czerny has no complete opus on PianoML** (3 of the 100 exercises of op. 599,
  single numbers of six other opuses), so `data/library/czerny-studies/` is 30
  studies ordered by grade instead of one rebuilt collection -- and unlike the
  Burgmüller files, these are cleanly engraved.
- **ii-V-I through the 12 keys** is pure generator territory: `musicKeys.ts`
  already spells chords out of any key, and walking the keys is the same shape as
  Hanon's walk up the scale.

## 3. Daily sight-reading

Sight-reading is a separate skill from learning a piece: translate the page into
gestures in real time, eyes never leaving the page. The app has nothing for it,
and it is the one thing a daily habit buys quickly.

The protocol, which the feature has to enforce rather than merely allow:

- New material every day, far below the player's level, and never the same twice.
- 20-30 seconds to scan it first (key, meter, hand positions, repeated motifs,
  leaps) before a single note.
- A ridiculously slow tempo, slower than instinct.
- Straight through without stopping: an error is not corrected and not replayed.

Consequences for us: it is the opposite of every existing mode (no rewind, no
loop, no section repeat), and it needs an endless supply of easy new scores --
either the exercise generator, or idea 1 filtered to `gradeStart=1` and tracked so
a score is never served twice.

Material to look at: hymn and folk-song collections (simple four-part writing,
mostly out of copyright, so actually harvestable), Bartók's Mikrokosmos vol. 1 and
the Faber Piano Adventures sight-reading books (ideal material, both still in
copyright -- reference only), and Sight Reading Factory as prior art for
generating infinite material at an exact level.
