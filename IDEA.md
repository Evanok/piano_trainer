# IDEA.md

Open ideas, one or two sentences each.

Dropped or done, never to be re-proposed: the position scrubber (done as
`LoopRangeBar`), MIDI file import (rejected -- MusicXML only), the note-naming
and note-to-key quizzes (done as the reading quiz's two answer modes), the
keyboard-free quizzes beyond those two, the daily challenge and progression
ladder built on top of them, and **any difficulty-grade system in the app**
(rejected twice: computing a grade from the score, and importing PianoML's own
grades -- `difficulty` stays a user-assigned label).

Also done, since it was most of what this file used to hold: the score library is
harvested (Burgmüller op. 100 complete, Czerny's scattered studies, two beginner
grade bands), imported, and browsable through the catalog's virtual folders
(`personal`, `beginner-1`, `beginner-2`, `study/<composer>`).

## 1. ii-V-I through the 12 keys

The one exercise idea still open, and pure generator territory: `musicKeys.ts`
already spells chords out of any key, and walking the twelve keys is the same
shape as Hanon's walk up the scale -- so it is a tab in `ExerciseSetup` plus a
generator, nothing else.

## 2. Daily sight-reading

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

## 3. Re-source the badly engraved études

16 of the 25 Burgmüller are MIDI-derived conversions whose time signature changes
every few bars (`meterConsistency` in each collection's `index.json`): playable,
ugly to read. `pnlong/PDMX` (250k public-domain MusicXML scraped from MuseScore,
human typesets, with a metadata CSV that can be searched without downloading the
scores) is the source to try against them.
