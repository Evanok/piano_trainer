# IDEA.md

Backlog of ideas not yet implemented. Unlike `CLAUDE.md`, which documents
decisions already made and the reasoning behind the code as it exists, this
file holds what we would like to do next and why. Nothing here is a
commitment, and nothing here has been designed in detail yet.

Section numbers are stable identifiers: an idea that gets built is removed and
the remaining ones keep the numbers they had, so "idea 4" means the same thing
across conversations. Gaps in the numbering are therefore deliberate.

## Context: PianoML

Several ideas below come from looking at [PianoML](https://pianoml.org)
([source](https://github.com/piano-ml/piano-ml), TypeScript, GPL-3.0), the
closest open-source project to this app found so far: a browser-based practice
tool built on real notation (MusicXML), not falling notes. Worth revisiting
whenever we look for prior art, since it solves several of the same problems
independently.

## 2. A scrubber/slider for moving through the piece

PianoML's cursor control for changing position is nicer than our Prev/Next
section buttons. Today, moving around means the section dropdown, the
Prev/Next buttons, the desktop "Go to measure" box, or a long press on the staff
on mobile (all funnelled through `jumpToMeasure` in `Practice.tsx`).

Idea: a continuous position control (a slider/scrubber over the whole piece)
that shows where you are in the piece and lets you drag to anywhere, instead of
stepping one section at a time. It would also double as a progress indicator,
which no control currently provides during practice.

Notes:
- Part of this now exists: "Scroll loop" has a measure bar spanning the whole
  piece with two draggable handles and a playhead marker
  (`components/LoopRangeBar.tsx`). It sets a loop range rather than seeking, so a
  scrubber would be the same bar with a third interaction, not a new control.
- It should go through `jumpToMeasure` like everything else, so section cropping
  keeps following the target measure and the cursor walk keeps happening with no
  crop active.
- Dragging implies many jumps in a row, and `goToEventIndex` does a full
  reset-every-position pass per jump (accepted today precisely because jumps are
  infrequent). A scrubber would need to commit on release, or that cost has to be
  reconsidered.

## 3. Score sources: PianoML has a large MusicXML library

PianoML carries a lot of MusicXML files, with a filter by grade/level, including
a large amount of beginner material. Worth investigating later as a source of
scores to practise -- especially beginner pieces, which are the hardest thing to
find as clean MusicXML.

To check before relying on it: what the licence/provenance of those files
actually is, per file, and whether anything can legitimately be reused or only
consulted.

## 4. An automatic difficulty grade for a score

PianoML also exposes a grade/level per piece. We have two adjacent things but
not this one:
- `computeGrade(successPercent)` (`src/engine/grade.ts`) grades *the
  performance* (S/A/B/C/D/F), not the piece.
- `CatalogEntry.difficulty` (`easy | medium | hard`) grades the piece, but is
  **user-assigned** -- it starts unset on upload and only ever changes through
  the edit form, because nothing in a MusicXML header states how hard a piece is
  to play.

Idea: derive a difficulty metric automatically from the score itself, so an
uploaded piece arrives with a level instead of waiting to be tagged by hand --
and so the catalog can be filtered/sorted by "what can I actually play right
now".

Candidate signals, all available from what we already parse:
- Note density (notes per measure, and per hand).
- Hand span and chord size (how wide a stretch, how many simultaneous notes).
- Rhythmic complexity (shortest durations used, tuplets, syncopation).
- Key signature and accidental count.
- Range and the number of octave/position shifts required.
- Tempo marking, where the file carries one.

Two things to settle if we build this:
- Where it is computed. The catalog already extracts metadata server-side
  (`server/scoreMetadata.ts`, versioned by `METADATA_VERSION` so improvements
  are re-derived for existing entries) -- an automatic grade fits that pattern
  well, including the re-derivation on version bump.
- How it coexists with the manual `difficulty` field. Most likely a separate,
  derived field, with the user-assigned one always winning when set, in the same
  spirit as "derived progress is never stored" -- rather than overwriting a
  human judgement with a heuristic.

### Prior art checked: Sightread does not have this

Looked at [sightread/sightread](https://github.com/sightread/sightread) (539
stars, the most developed open-source project in this space) to see whether they
had solved it. They have not:

- `SongMetadata.difficulty` is a plain `number` carried as metadata, filled from a
  generated (not committed) `builtin-manifest.json` for the bundled songs. Any
  file the user opens themselves is hardcoded to `difficulty: 0`
  (`src/features/persist/persistence.ts`), and the value is not displayed,
  sorted, or filtered on anywhere in the UI. So it is a hand-curated label on
  their own catalog, nothing computed -- the same situation as our manual
  `CatalogEntry.difficulty`, minus the edit form.
- Their roadmap (`src/pages/about/page.tsx`) does list "Difficulty scaling for
  algorithmically scaling the difficulty of a song up and down" as a future idea.
  Note that this is a *different* feature from ours: making a piece easier or
  harder by rewriting the arrangement, not rating how hard it already is.

Two incidental findings from that repo, worth keeping:

- `scripts/detect-good-song.ts` curates a MIDI collection with exactly one
  heuristic: a file with **exactly two piano tracks** is "almost definitely
  excellent". That is a quality/usability filter rather than a difficulty metric,
  but it is precisely the precondition the MIDI import in section 5 needs for
  hand splitting -- the same test would tell us up front whether an imported file
  can support hand mode or needs the middle-C fallback.
- `scripts/generate-score-meta.ts` shells out to the MuseScore 4 CLI
  (`mscore --score-meta`) to harvest title, duration, measures, time signature,
  tempo, key signature and parts from MIDI files. A reminder that several of the
  signals listed above can be obtained without writing a parser, at the cost of a
  heavy non-browser dependency -- viable for an offline/server batch job, not for
  an upload path.


## 5. Support MIDI files as a score source

Today the only accepted input is MusicXML (`.musicxml` / `.xml` / `.mxl`), because
OSMD reads nothing else. A lot of the piano material circulating online is
`.mid`, so accepting it would widen the usable library considerably.

**Is it easy? Parsing is; transcription is not.** The two halves of the job have
very different difficulty:

- Reading a MIDI file in the browser is a solved problem (`@tonejs/midi`, small
  and well-maintained). Emitting MusicXML is something this repo already does in
  `engine/musicKeys.ts` (`asMusicXmlPitch`, `createMusicXmlFile`) for the
  generated exercises. So the plumbing is short.
- Turning MIDI into *notation* is the actual work, and there is no mature
  JavaScript library to lean on: `turnerhayes/midixmljs` is the only direct
  attempt found (20 stars, self-described as in development and not suitable for
  use, last touched 2023). Everyone doing this in a browser hand-rolls it.

MIDI is a performance format, so the conversion has to invent everything
notation needs and MIDI does not carry: notated durations and rests (from raw
tick on/off times), a quantization grid, voice separation, which notes belong to
which staff, enharmonic spelling (D-sharp or E-flat), ties versus re-articulation,
tuplets, and beaming (which OSMD will not infer -- the Hanon generator already
had to emit explicit `<beam>` elements for exactly this reason).

**What works in our favour:** this app is wait-gated, with no tempo pressure and
no audio playback, so `WaitEngine` only ever consumes a *sequence of pitch sets*.
Rhythmic inaccuracy in the conversion costs readability, not correctness -- a
crudely quantized import is still perfectly playable, just ugly to read. A
playback-oriented app could not make that trade. Bar structure does still have
to be sane, since measure numbers drive sections and every jump-to-measure path.

Suggested scoping:
- **First pass (small).** Accept `.mid`, quantize to a fixed grid (sixteenths),
  take the time signature and key signature from the MIDI meta events with 4/4
  and C as defaults, map tracks/channels to two staves, and emit MusicXML through
  the existing primitives. Everything downstream -- OSMD, `ScoreParser`,
  `WaitEngine`, sections, hand mode -- then works unchanged, and chords already
  have a path (`<chord/>` notes as one expected event). This is good enough for
  MIDI exported from notation software, which is already quantized and has the
  hands on separate tracks.
- **Second pass.** Rest insertion, dotted and triplet durations, key detection
  for enharmonic spelling, per-hand voice separation, and a pitch-split fallback
  around middle C for the very common single-track file where both hands are
  merged (as they are in a Synthesia-style rip). Without that fallback, hand mode
  silently degrades to "both", since `selectHandStaff` needs exactly two playable
  staves.
- **Not worth attempting.** Real transcription of an expressively played human
  performance (rubato, no grid). That is a research problem, not a feature.

Cheapest option of all, and the baseline any in-app importer should be measured
against: document that MuseScore imports MIDI and exports MusicXML, and build
nothing. It converts better than a first pass would, at the cost of leaving the
browser.


## 6. Sight-reading drills at the keyboard (a "Lecture" tab)

Everything the app offers today is built around *repetition*:
`sectionTraining` rewinds a section until it is clean, `scrollLoop` repeats a
chosen passage forever, and Hanon is one figure walked up and down the scale.
Sight-reading is the opposite skill, reading something never seen before, once,
and nothing in the app trains it. The generated exercises come closest but are
used as drill material rather than as one-shot reading.

Shape: another tab in `ExerciseSetup` next to Generated and Hanon, plus another
generator. That is exactly the extension path `ExerciseKind` was designed for,
so everything downstream (Practice, the hidden virtual keyboard, the key-signature
badge, the session log) already gives the right answers with no change.

### 6.1 One-shot reading

Fresh 4 to 8 measures every time, a single pass, no loop, no rewind, no second
attempt at the same material. The score is first-try accuracy, which is already
what `successPercent` measures. `createTrainingExercise` re-rolls a seed per
call, so the material exists; what is missing is a mode that *forbids* repeating
it. Probably also forces keyboard assist off, since an assist turns reading into
following.

### 6.2 Look-ahead trainer (masking)

Cover the current measure the moment the cursor enters it, so the player can only
succeed if they already read ahead. This is the classic teacher's hand over the
bar, and it is the single most direct way to train reading ahead.

An overlay drawn in `PianoScore` over the current measure's graphical box, so it
touches neither `WaitEngine` nor `ScoreParser`. The geometry comes from the same
graphical model `measureAtClientPoint` already queries. Levels worth offering:
mask the current note, the current half measure, the whole current measure.

### 6.3 Ledger lines and register ladder

A progression that deliberately pushes above and below the staff by steps
(middle C only, then one ledger line, then two, then three). Mostly a widening of
the octave bounds already in `TrainingSettings`, plus an order to walk them in.

### 6.4 Interval-constrained melodies

A good reader reads shapes, not letters. Constrain the generator's degree walk:
steps only first, then thirds, then wider leaps. The generator already works in
scale degrees, so this is a constraint on `PhrasePlan`, not new machinery.

### 6.5 Key signature drill

The same melody regenerated in a random key, with the accidentals carried by the
armure only and never written as explicit accidentals, so reading it requires
actually applying the key signature. `musicKeys.ts` already spells notes out of
the key correctly, which is the hard part.

### 6.6 Adaptive drill built from your own confusions

Session records already carry missed notes, wrong notes, confusions and response
times, for real scores as well as exercises, and nothing ever reads them back.
Generating an exercise that over-represents the notes actually being missed is
the one idea here that no comparable tool can copy, because the data is already
being collected.

To check before building: the real quality of that data in `stats.json`. If the
confusions are dominated by fumbles rather than by reading errors, the drill
would train the wrong thing.

### 6.7 Rhythm-only drill on one pitch (deliberately parked)

Everything played on a single note, with the difficulty entirely rhythmic. It is
parked rather than dropped: judging *time* contradicts the founding premise of
wait mode (no tempo pressure, advance only on correctness), so it would need a
timing-judgement path beside `WaitEngine` rather than inside it. Worth revisiting
only once the reading side is covered.

## 7. Keyboard-free reading drills (phone, away from the piano)

Safari on iOS has no Web MIDI at all, and away from home there is no keyboard
either, so today the app offers literally nothing in that situation. These
exercises are also the right size for a few minutes standing in a train, which is
the moment reading fluency is actually cheap to buy.

This is the one family that does not go through `Practice` at all: no MIDI
stream, no OSMD cursor, no `WaitEngine`. It gets its own screen.

**Scope retained (2026-08-29): 7.1, 7.2 and 7.6 first**, entered from a
"Lecture" tab in `ExerciseSetup` (section 6's tab, shared). The tab's start
button goes to the quiz screen, *not* to `Practice`. 7.3, 7.4, 7.5 and 7.7 stay
in the backlog behind them.

Decisions taken with the user, so they are not re-opened later:

- **One session log, one streak, three separate time counters.** A quiz is
  recorded as an ordinary `PracticeSessionRecord` with a third `SessionSource`
  kind, `reading`. That buys the cross-device sync (merge by id), the sitting
  grouping and the streak for free, and a quiz on the phone *does* keep the
  daily streak alive, which is the whole point of training away from the piano.
  Practice *time*, on the other hand, is reported split three ways by
  `source.kind`: real scores,
  keyboard exercises (generated and Hanon), and reading quizzes. The user asked
  for a real separation, and three buckets is the same work as two since the
  discriminator already exists, so no reading of "real practice versus drills"
  has to be guessed at. The streak stays single: only the time counters split.
- **The record's fields map onto a quiz almost as they are**: `totalEvents` is
  questions asked, `correctNoteCount` right answers, `errorCount` wrong ones,
  `successPercent` first-try accuracy, `maxCombo` the best run, and
  `notes.confusions` (expected versus played) is exactly "shown a C, answered D",
  which is the most useful number the whole exercise produces. `practiceMode` and
  `handMode` mean nothing here and become optional on the record. A finished
  quiz is marked `completed`, so it counts even at 40 seconds, the same rule a
  cleanly played generated exercise already gets.
- **Note names are latin (do re mi)** in the quiz UI, not letter names.
- **One OSMD load per round, then crop per question.** Not one OSMD instance per
  question (far too heavy for a rapid-fire quiz) and not a second hand-drawn SVG
  staff renderer (which would also need the Bravura glyphs for the clefs).
  Generate the whole round as one MusicXML of about twenty notes, one per
  measure, load it once, and move from question to question with
  `MinMeasureToDrawIndex`/`MaxMeasureToDrawIndex`, the same crop the section modes
  already use. Identical engraving to the practice screen, no new dependency.
  This is the part to spike first: it is the only real unknown left.
- **No offline story, deliberately.** 7.6 downloads the score from the API like
  every other catalog read, and nothing is cached locally for a network-less
  phone. Explicitly ruled out by the user rather than forgotten: the device that
  runs these quizzes has a connection.

### 7.1 Note naming quiz

A note on a staff, seven buttons, sixty seconds, a score and a streak. The
cheapest exercise in the list and the base brick every other one here reuses.

### 7.2 Note to key

A note on a staff, tap the matching key on the existing `VirtualKeyboard`. More
useful than 7.1 because it trains the real association, note to key position,
rather than note to letter name. The component already draws 88 keys, scrolls,
and marks middle C, which is exactly the landmark problem this exercise is about.

### 7.3 Interval quiz

Two notes shown, name the interval. The theory-side companion to 6.4.

### 7.4 Key signature quiz

An armure shown, name the key, or the reverse. Purely memory work, very short,
ideal on a phone. The table is already in `musicKeys.ts`.

### 7.5 Rhythm tapping

A rhythm is displayed, tapped on screen with one finger, scored on deviation. No
piano needed, and it trains the half of reading that always gets neglected. Same
caveat as 6.7: it introduces time judgement, but here there is no `WaitEngine` to
contradict, since the quiz screen is its own thing.

### 7.6 Flash reading on your own catalog

Pick a random measure from a score already in the catalog and quiz on it. Ties
the away-from-home training to the actual repertoire being worked, and reuses the
catalog and OSMD unchanged.

### 7.7 Silent read and recall

A measure is shown for a few seconds, then hidden, and the notes have to be
recalled. This trains chunking, which is what actually separates a fluent reader
from a note-by-note one.

## 8. Daily challenge and a progression ladder

Two wrappers over sections 6 and 7 rather than exercises of their own.

### 8.1 Daily challenge

One short exercise, identical on every device because the seed is derived from
the date alone, a single attempt, graded with the existing `computeGrade`, and it
feeds the streak that already exists. The record has to carry the fact that it
was the daily one, otherwise a second attempt would be counted as a fresh score.

### 8.2 Progression ladder

A guided path that widens range, keys and interval size on its own, instead of
asking for six settings before every exercise. `ExerciseSetup` is a good screen
for someone who knows what they want to drill, and a poor one for "just give me
the next thing".

## Priority note for sections 6 to 8

The biggest unknown in the whole group is the keyboard-free screen: a quiz flow
with no MIDI, an isolated staff renderer, and a session record for something that
is not playing. Building 7.1 and 7.2 first settles all three at once, after which
7.3, 7.4, 7.6, 7.7 and section 8 are nearly free.

On the piano side, 6.1 and 6.2 are the two that add something the app genuinely
cannot do today, and 6.2 is very local (an overlay in `PianoScore`). 6.6 is the
most original but depends on data whose quality has not been checked yet.
