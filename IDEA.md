# IDEA.md

Open ideas, one or two sentences each.

Dropped or done, never to be re-proposed: the position scrubber (done as
`LoopRangeBar`), MIDI file import (rejected -- MusicXML only), the note-naming
and note-to-key quizzes (done as the reading quiz's two answer modes),
**keyboard-free quizzes that only rename notes** (naming is covered twice over,
so a screen drill now has to teach something the reading quiz does not in order
to earn a tab -- the chord quiz does, see below, and that is the bar), **any
screen drill answered by tapping the virtual keyboard** (rejected on use: the
keys are too small to hit reliably, and the name-button drills are the ones
actually played -- note that answering on a REAL MIDI keyboard is a different
proposition and is built, as the chord drill's `play` step), the daily challenge and progression
ladder built on top of them, and **any difficulty-grade system in the app**
(rejected twice: computing a grade from the score, and importing PianoML's own
grades -- `difficulty` stays a user-assigned label).

Also done, since it was most of what this file used to hold: the score library is
harvested (Burgmüller op. 100 complete, Czerny's scattered studies, two beginner
grade bands), imported, and browsable through the catalog's virtual folders
(`personal`, `beginner-1`, `beginner-2`, `study/<composer>`).

## 1. Chord quiz: the rest of the ladder

Built (`engine/chordQuiz.ts`, `pages/ChordQuiz.tsx`, lesson in
`components/ChordLesson.tsx`): four independent axes -- accidentals, stacking,
what is answered, clef -- over triads in every quality and inversion. **Not
levels.** Levels were the original plan and were wrong: they bundle variables
that the player has every reason to combine freely, and they make a restricted
starting point look like a curriculum rather than what it is.

**Two restrictions each produced a fake exercise, and both were found by
playing it rather than by reasoning.** Root position makes naming the chord
identical to naming the bottom note, so that mode asked nothing -- inversions
fixed it. And no-accidentals makes every letter carry exactly one possible
chord, so the quality could be recited from a seven-row table instead of
measured -- and worse, the lesson presented that table as a rule, which taught a
player that "sol is a major chord". Accidentals fixed that one. Both restrictions
are still available as warm-ups; neither is a default worth teaching from.

The general lesson, and the one to apply to everything below: **a change that
makes the material harder is not the same as a change that makes the question
deeper, and only the second is worth building.** A restriction is also never
neutral -- it silently invents rules that only hold inside it, and the lesson
has to say so out loud.

What is left:

2. **Naming a chord on an altered root.** Today the root step is restricted to
   the seven natural letters, because seven buttons cannot say "fa sharp", so
   accidentals are only fully exercised in the quality and play steps. A subset
   of candidate buttons (below) was the planned fix, but the step split makes a
   cheaper one available and it should be tried first: a second tiny keypad of
   three buttons (♭ / ♮ / ♯) between the letter and the quality, which asks the
   same question with no distractors to draw and no elimination to leak.
3. **Splitting the round summary's accuracy by inversion and by quality.** The
   answer deliberately never asks which inversion it was, but reporting it is
   the one thing the drill can tell you that you cannot feel while playing.
4. **Arpeggios: the same three notes written in sequence rather than stacked.**
   Directly useful, since the pieces actually being played are full of them and
   contain almost no block chords -- recognising that a six-note run is a sol
   chord in second inversion is the same skill on material already in the
   repertoire. Same generator, different note emission.
5. **+ a real key signature.** Not decoration: the altered note becomes
   *implicit*, and reading a mi-flat because the piece is in si-flat major is a
   different act from reading a written flat in front of the note. That is the
   skill this rung exists for. It also opens the roman numerals as a question in
   their own right ("in la major, which chord is IV"), which is the phone-side
   twin of the ii-V-I generator below -- drill the knowledge away from home,
   play it on return.

**When a rung has too many possible answers, draw a subset of candidates rather
than every one of them** -- naming a chord on any root is twelve roots times four qualities,
which is not a keypad. The right answer is always in the lot, and the drawn
distractors have to be indistinguishable from it *a priori*: drawn from the same
pool by the same rule, and ideally including the near-misses the confusion stats
show are actually being mixed up. Drawn carelessly, a subset leaks the answer
(one plausible candidate among five absurd ones is not a question) and turns the
drill into elimination, which is easier than recall -- so this is a fallback for
a keypad that cannot exist, not an improvement on one that can. The natural-root
name answer does not need it: seven names is the reading quiz's own keypad.

Two things deliberately off this ladder: **spread voicings** (a level 5 at best;
three notes inside the octave is what a triad looks like while it is being
learnt), and **answering by tapping the virtual keyboard**, per the rejection
above -- which is about the on-screen keys, not about playing the chord: that is
the `play` step, and it is built.

**What the drill asks is a list of steps, not a mode** (`ChordAnswerStep`: root,
quality, play, any combination, always in that order). The alternative -- one
tap naming both the root and the quality -- was rejected before it was built,
because twelve roots times four qualities is not a keypad and would have needed
the subset rule below, which is a fallback rather than an improvement. Two small
keypads ask the same question without it, in the order the chord is actually
read (the root first: on an inverted stack the bottom interval is not the
chord's own third, so the quality cannot be measured until the root is found),
and a miss then says *which* of the two was missed. The `play` step is the one
place a screen drill touches real hardware, and it is deliberately a plain
setting rather than something detected: it costs the stats nothing (a fat finger
is not a misreading) and is untimed, because what it trains is the mapping from
a written stack to a position under the hands, not a reading speed.

## 2. ii-V-I through the 12 keys

Still open, and pure generator territory: `musicKeys.ts`
already spells chords out of any key, and walking the twelve keys is the same
shape as Hanon's walk up the scale -- so it is a tab in `ExerciseSetup` plus a
generator, nothing else.

## 3. Daily sight-reading

Reading a piece never seen before, once, without stopping -- the opposite of
every existing mode (no rewind, no loop, no section repeat), and the one skill
the app does not train at all.

The protocol, which the feature has to enforce rather than merely allow:

- New material every day, far below the player's level, and never the same twice.
- 20-30 seconds to scan it first (key, meter, hand positions, repeated motifs,
  leaps) before a single note.
- A ridiculously slow tempo, slower than instinct.
- Straight through without stopping: an error is not corrected and not replayed.

What is missing is the mode itself, plus remembering which scores have been served
so one is never given twice.

### Material: nothing is settled yet

**The harvested beginner bands are unverified.** `beginner-1` and `beginner-2`
hold ~136 pieces, but nothing in them has actually been played, and a first look
says a good part of it is not beginner material at all. The tags mean "PianoML
grade 0-1 / 1-2", and those grades are half human labels from pianosyllabus.com
and half the output of a model whose own README reports 47% accuracy and a mean
error of 0.8 grade. Sight-reading also wants something *far below* the player's
level, which is stricter than "graded easy". So the first task here is to play a
sample and find out what the bands are really worth -- everything below stays a
candidate until then.

Candidate sources, listed because listing costs nothing:

- **Faber, *Piano Adventures Sight Reading Book*** (Nancy and Randall Faber;
  Primer Level, then 1, 2A, 2B, 3A, 3B, 4, 5) -- designed for exactly this drill,
  one short reading a day, each a small variation on a piece already learnt. Print
  and PDF only: there is no MusicXML edition, so it can inspire the generator's
  variation rules but cannot be imported.
- **Bartók, *Mikrokosmos* vol. 1 and *For Children*** -- 24 pieces already
  harvested in `study/bartok`, short, progressive and musically real. The most
  promising of what we already hold.
- **Nineteenth-century methods**, which do Faber's job and are out of copyright:
  Köhler, Beyer, Duvernoy, Le Couppey, Türk, Diabelli, Streabbog, Gurlitt. The
  harvester's `graded` mode takes a composer name, so each is one config entry.
- **Hymnals and folk-song collections** -- simple four-part writing, huge volume,
  mostly public domain. Also the easiest to sight-read badly, which is the point.
- **`pnlong/PDMX`** -- 250k public-domain MusicXML scraped from MuseScore, human
  typesets rather than MIDI conversions, with a metadata CSV searchable without
  downloading the scores.
- **Sight Reading Factory** -- prior art rather than a source: a paid service that
  generates endless material at an exact level, which is what the generator would
  be doing.
- **Our own generator** -- the only one that can guarantee "never the same twice"
  and an exact level. Needs reading-specific constraints (interval size, register,
  fixed hand position) plus a mode that forbids replaying.

## 4. Re-source the badly engraved études

16 of the 25 Burgmüller are MIDI-derived conversions whose time signature changes
every few bars (`meterConsistency` in each collection's `index.json`): playable,
ugly to read. `pnlong/PDMX` (250k public-domain MusicXML scraped from MuseScore,
human typesets, with a metadata CSV that can be searched without downloading the
scores) is the source to try against them.
