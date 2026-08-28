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
