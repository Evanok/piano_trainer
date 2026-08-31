# IDEA.md

Open ideas, one or two sentences each.

Dropped or done, never to be re-proposed: the position scrubber (done as
`LoopRangeBar`), an automatic difficulty grade (rejected -- difficulty stays
user-assigned), MIDI file import (rejected -- MusicXML only), the note-naming and
note-to-key quizzes (done as the reading quiz's two answer modes), the
keyboard-free quizzes beyond those two, and the daily challenge and progression
ladder built on top of them.

## 1. Harvest MusicXML for our own catalog

Clean beginner MusicXML is the scarce resource for this app, and
[PianoML](https://github.com/piano-ml/piano-ml) carries a large graded library of
it (sightread's own collection is MIDI, so it is out). Check the licence per file,
then seed `data/scores/` with a one-off offline script rather than an in-app
importer.

## 2. Exercises more fun than Hanon

Hanon is dull, and `ExerciseKind` was built so another drill is a tab plus a
generator. Two directions, and they need different work:

- **Czerny op. 599 / Burgmüller op. 100** are written pieces, not rules, so they
  are a harvesting job (idea 1) rather than a generator -- both composers are long
  out of copyright, but any given typeset is not.
- **ii-V-I through the 12 keys** is pure generator territory: `musicKeys.ts`
  already spells chords out of any key, and the walk through the keys is the same
  shape as Hanon's walk up the scale.

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
which the exercise generator can produce today, unlike a harvested catalog that
runs out.

Material to look at: hymn and folk-song collections (simple four-part writing,
mostly out of copyright, so actually harvestable), Bartók's Mikrokosmos vol. 1 and
the Faber Piano Adventures sight-reading books (ideal material, both still in
copyright -- reference only), and Sight Reading Factory as prior art for
generating infinite material at an exact level.
