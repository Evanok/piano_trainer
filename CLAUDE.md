# CLAUDE.md
This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` -- start the Vite dev server (port 5173 by default); the catalog API is mounted on it, so this is still a single process
- `npm run build` -- typecheck (`tsc -b`) then production build
- `npm start` -- production server: serves `dist/` + the catalog API (`PORT`, default 5173). It is exposed directly at `http://51.159.55.29:5173/`; do not use Nginx or a reverse proxy for Piano Trainer.
- `npm test` -- run the vitest suite once
- `npx vitest run src/engine/WaitEngine.test.ts` -- run a single test file
- `npx tsc -b --noEmit` -- typecheck only, no build output
- `npm run lint` -- oxlint

There is no test runner watch mode wired up as a script; use `npx vitest` (no `run`) directly for watch mode.

## Production deployment

The VPS runs the app directly on TCP port 5173, managed by PM2. There is no
Nginx configuration for this project. Use the repository script rather than
running PM2 commands by hand:

```bash
./deploy.sh prod start  # npm ci, production build, then public server on :5173
./deploy.sh prod stop
./deploy.sh dev start   # Vite, bound only to 127.0.0.1:5173
./deploy.sh dev stop
```

For later production deployments, run `git pull --ff-only` then
`./deploy.sh prod start`. The script deliberately does not pull implicitly,
so it never unexpectedly changes a checked-out VPS worktree. It stops the
other mode before starting one because both use port 5173. If production is
not reachable publicly, check that TCP 5173 is open in the VPS firewall/security
group.

## What this is

A piano practice web app ("Wait Mode", Simply-Piano-style): load a MusicXML/`.mxl` score, connect a MIDI keyboard, and the score only advances when the correct note(s)/chord are played -- no tempo pressure, no audio playback. Founding brief and full feature roadmap: see memory/project context from prior sessions (not duplicated here since it evolves independently of the code).

## Architecture

### Data flow

`Home` is a small intent menu (`Exercise` / `Practice a score` / `Stats`). `App` holds the loaded `File`, a `PracticeSourceKind` (`score` or `generated-training`), and switches screens (`home` / `exercise-setup` / `score-library` / `stats` / `practice` / `end`, plain `useState`, no router). `ExerciseSetup` builds generated MusicXML exercises in memory; `ScoreLibrary` owns upload/catalog browsing; both enter the shared `Practice` pipeline; `Stats` summarizes local exercise history; `End` shows session stats. `useMidi` is instantiated once in `App` (not per-screen) so the Web MIDI permission prompt only fires once per session and device state survives screen switches.

### Navigation and source kinds

The app deliberately avoids a router for now: `App.tsx` owns the screen enum and passes callbacks down. Keep `Home` as an intent menu only. Put generated-exercise settings in `ExerciseSetup.tsx`, real-score upload/catalog/search in `ScoreLibrary.tsx`, and local exercise-history summaries in `Stats.tsx`. Both playable flows must pass a real `File` into `Practice`; use `PracticeSourceKind` rather than filename heuristics whenever behavior differs between generated exercises and real scores. Currently generated exercises hide the mobile virtual keyboard so it does not give away answers, while regular scores keep it visible on mobile as a compact aid.

`createTrainingExerciseFile()` returns an in-memory `.musicxml` `File`; generated exercises are not uploaded to or listed in the catalog. Exercise generation supports `contentMode: 'notes' | 'triads' | 'mixed'`. Single-hand exercises apply that mode to the active hand; two-hand exercises keep a right-hand melody and apply the mode to the left-hand accompaniment. Triads are emitted as MusicXML chord notes with `<chord/>`, which the existing OSMD extraction and `WaitEngine` chord path consume as one expected event.

`ExerciseKind` (`'generated' | 'hanon'`) picks which generator builds the exercise, and is a **tab inside `ExerciseSetup`, not a `Home` tile and not a third `PracticeSourceKind`**. Home stays an intent menu ("I want to do an exercise"); which drill is a setting. And everything downstream of `Practice` -- hidden virtual keyboard, key-signature badge, "Next exercise", `exerciseStatsStore` -- wants the same answers for a Hanon drill as for a generated one, so both stay `'generated-training'`. Adding more drill types (scales, arpeggios, cadences) means another tab plus another generator, nothing else. `ExerciseRequest` is the discriminated payload `ExerciseSetup` hands to `App.startExercise`, so each kind carries only its own settings type. Keyboard help and backing track are shared across kinds and live below the per-kind panel.

### Exercise generators (`engine/musicKeys.ts`, `engine/trainingGenerator.ts`, `engine/hanonGenerator.ts`)

`musicKeys.ts` holds the one key table (`KEYS`, `TRAINING_KEY_NAMES`, `RANDOM_KEY`), diatonic/chromatic pitch spelling, and the shared MusicXML primitives (`asMusicXmlPitch`, `xmlEscape`, `createMusicXmlFile`, `accidentalsLabel`). Every generator imports from it; there must not be a second key table.

**Hanon** (`hanonPatterns.ts` + `hanonGenerator.ts`) covers "The Virtuoso Pianist" Part 1, exercises 1-20. It is *generated, not imported*, and that is the point: every one of these exercises is one short figure whose root walks up the scale a degree per measure and then back down, so storing the rule instead of the notes buys transposition to any key and free choice of register -- neither of which a MusicXML of the printed (C major only) edition can give. `figure` offsets are in **scale degrees, not semitones**, and roots are degree indices with 0 = tonic (C4 in the original); `pitchAtDegreeIndex` spells the note out of the key so a transposed exercise reads correctly (index 3 in B-flat major is E-flat, not D-sharp). The left hand doubles the right exactly one octave below, everywhere, so only one line is ever generated. Notation is sixteenths in 2/4 with `<divisions>4</divisions>`; the closing tonic gets its own measure as a half note.

Four things worth knowing before touching it:
- **There is no randomness at all**, deliberately -- same settings, same score. `createTrainingExercise` re-rolls a seed per call; `createHanonExercise` must not.
- **The one-measure segments in the table are real irregularities in the original**, not artifacts: Hanon alters the figure's last note or two at each turnaround so the hand lands where the next direction needs it. `descendingSegmentIndex` uses the first segment whose root walks *downwards* to split the two halves, so those turnaround measures stay attached to the half they follow (this is what `length: 'ascending'` cuts on).
- **Explicit `<beam>` elements are required.** OSMD does not auto-beam; without them a measure renders as eight separate flagged sixteenths, which is unreadable.
- **A measure whose durations do not add up does not throw in OSMD**, it just renders wrong, so `hanonGenerator.test.ts` sums `<duration>` per voice per measure for all 20 exercises rather than leaving it to be spotted by eye.

The pattern table was derived from the exercises' own note content and cross-checked note-for-note against two independent public sources that agree exactly (`bluekeyes/hanon`'s `exercises.json` for 1-6, and reference MIDI renderings of 1-20 in `yogibooboo/Hanon_Test`). Hanon died in 1900, so the music is public domain everywhere; note that an IMSLP/MuseScore *typeset* of it carries whatever licence its contributor chose, which is a reason to generate rather than commit someone's engraving.

### Score catalog (`server/`, `src/api/catalog.ts`)

The only server-side part of the app: uploaded scores are kept on disk so they can be re-opened later without re-picking the file. Deliberately dependency-free (`node:http` + `node:fs`, no framework, no database) -- it's a single-user personal deployment, not a service.

- **One handler, two hosts.** `createCatalogApi()` (`server/catalogApi.ts`) is a connect-style middleware. In dev, `vite.config.ts` mounts it on the Vite dev server (so `npm run dev` stays one process); in production `server/index.ts` mounts it in front of a static `dist/` file server. There is no second implementation of the endpoints to keep in sync, and no dev-only proxy config.
- **Endpoints:** `GET /api/scores?q=&page=&limit=` (search + pagination, most recent first), `POST /api/scores?filename=` (the file is the raw request body -- posting `multipart/form-data` instead would mean shipping a parser for no benefit), `GET /api/scores/:id/file`.
- **Names come from the score, not the file name** (`server/scoreMetadata.ts`): `<work-title>` (then `<movement-title>`) and `<creator type="composer">`, since files are usually downloaded under a slug (`persona-5-piano-the-days-when-my-mother-was-there.mxl`). A `.mxl` is a ZIP, opened with `jszip` -- the same library OSMD itself uses to read those files, so anything the app can render, the catalog can read. Extraction is deliberately regex-based on three flat elements rather than a full XML parse (Node has no DOM, and an XML parser would be a lot of dependency for `<work-title>`). Only the **first non-empty line** of a field is kept: a multi-line title/creator is nearly always the same name repeated in another script. It's best-effort -- an unreadable header yields nulls and falls back to `titleFromFilename` (slug -> "Tchaikovsky Album for the Young"), never a rejected upload.
- **`METADATA_VERSION` + `migrateCatalog()`**: entries are stamped with the extraction version that produced them, and anything older is re-derived from disk at startup (`vite.config.ts` in dev, `server/index.ts` in prod, both non-fatal on failure). Bump the constant when the extraction rules change, otherwise the improvement only ever reaches *newly uploaded* scores. `metadataVersion` is server-side bookkeeping the front-end ignores (`StoredEntry` vs the shared `CatalogEntry`).
- **Storage** (`server/catalogStore.ts`): `<dataDir>/catalog.json` + `<dataDir>/scores/<uuid><ext>`, where `dataDir` is `PIANO_TRAINER_DATA_DIR` or `./data`. Resolved from `process.cwd()` on purpose, *not* from `import.meta.url`: in dev this module is bundled into a temporary Vite config file at an unrelated path, which would silently move the data directory. `data/` is gitignored, and lives outside `public/` so Vite never serves it statically -- `server.watch.ignored` also excludes it, otherwise every upload would trigger a full page reload and drop a practice session in progress.
- **The stored file name is always `<generated uuid><ext>`**, never the uploaded name, so a crafted filename can't escape the scores folder; ids coming back in a URL are checked against a UUID pattern before touching the filesystem. `catalog.json` is written tmp-then-rename, and a corrupt `catalog.json` throws instead of being read as an empty list (an empty list would be overwritten by the next upload, losing every entry while the score files are still on disk).
- **`downloadScoreFile()` rebuilds a real `File` with the original filename** (`new File([blob], entry.filename)`) before handing it to `App`/`Practice`. The name matters: OSMD decides whether to unzip (`.mxl`) or parse XML from it, so a catalog score has to reach `PianoScore` exactly as a freshly picked file would. Everything downstream of `onFileLoaded` is unchanged and can't tell the two apart.
- **Upload failure does not block practice.** `ScoreLibrary` awaits the upload before switching screens, and on failure shows the error plus a "practice without saving it" button -- an unreachable catalog degrades to the old behaviour rather than either blocking the session or silently losing the score.

`queryCatalog` (`server/catalogQuery.ts`) is pure and unit-tested (`server/catalogQuery.test.ts`): search is AND over whitespace-separated terms against title + filename, sorting is by `uploadedAt` descending with the id as a tie-break (two uploads can share a millisecond, and an unstable sort there would make entries jump between pages).

### The core pipeline (`src/engine/`, `src/components/PianoScore.tsx`)

1. **`ScoreParser.extractExpectedEvents(osmd)`** walks the OSMD cursor once and produces a flat `ExpectedEvent[]` (`{ index, pitches, measureNumber }`), one entry per playable position (a single note or a chord). It filters out two kinds of cursor positions that must NOT require a keypress:
   - rests
   - tie continuations (`isTieContinuation`, exported from this file) -- a tied note sustains, it isn't re-struck. `PianoScore.tsx`'s cursor-stepping (`next()`, `goToEventIndex()`) uses the same `requiredNotesUnderCursor()` filter to stay index-aligned with this list; if that filter ever drifts out of sync between the two, the OSMD cursor and the WaitEngine's `currentIndex` desync and note coloring silently breaks (nothing colors at all) even though playback logic still advances correctly.
   - `noteToMidi(note)` converts OSMD's `Note.halfTone` to a standard MIDI number (`halfTone + 12`) -- do not reconstruct pitch from `Pitch.Octave` directly, it uses a different internal octave convention (`Pitch.OctaveXmlDifference`) than the MusicXML octave and will be off by whole octaves.

2. **`WaitEngine`** is a pure, DOM-free state machine: `noteOn(pitch, timestamp)` returns `'waiting' | 'error' | 'done'`. Chord notes can be played in any order, held together within `chordToleranceMs` (`DEFAULT_CHORD_TOLERANCE_MS`, 2000ms) of the first note of the attempt; a correct note arriving after that window expires the earlier ones (fresh attempt, not accumulated). A wrong note always fully clears held progress immediately, regardless of timing. `expireStaleHold(now)` lets a UI timer proactively expire a stale hold (rather than only checking lazily on the next keypress) so the screen can visually decay even when the user just pauses.

3. **`PianoScore`** (imperative handle via `forwardRef`) owns the live `OpenSheetMusicDisplay` instance and all note-coloring. The sheet only ever shows two colors: yellow (`#eab308`, not yet held) and green (`#22c55e`, correct -- persists permanently once completed, `next()` never resets it). There is no "wrong note" color on the sheet itself -- `syncNotes(heldPitches: number[])` just recomputes green/yellow from the engine's actual held pitches every time; a wrong keypress is shown precisely on the `VirtualKeyboard` instead (below), not by reddening other expected notes vaguely. Coloring is done directly on SVG elements (`colorNotes`/`tryColorNoteFast`), not by calling `osmd.render()` per keystroke -- a full render() took ~370ms on a large real-world score. Three non-obvious things this depends on:
   - a chord's notes share one VexFlow SVG group; `vfnoteIndex` picks the correct notehead within it
   - the notehead's own child `<path>` carries its own explicit `fill` that overrides the parent group's -- both must be set
   - some notes (seen on complex real scores) have no resolvable graphical reference via the fast path; `colorNotes` falls back to `note.NoteheadColor` + a single batched `render()` for just those, so correctness never depends on the fast path succeeding.

   `drawComposer`/`drawLyricist`/`drawCredits` are all off -- those credit lines aren't covered by `drawTitle: false` and otherwise push the whole staffline down, most visible in scroll mode where there's no full page of margin to absorb it.

4. **`Practice.tsx`** is the glue: subscribes to `useMidi`'s note-on stream, feeds `WaitEngine.noteOn()`, and drives `PianoScore`'s imperative methods (`next()`, `syncNotes(heldPitches)`, `goToEventIndex()`) plus the decay timer described above. `wrongPitches: number[]` accumulates (not replaces) every wrong pitch since the last decay/advance, so playing several wrong notes at once shows all of them on the keyboard, not just the last one. It also tracks session stats (`SessionStats`): `successPercent` is first-try accuracy (percentage of events with zero wrong presses before completion), not `(total-errors)/total`, which can go negative if one event is retried many times.

5. **`VirtualKeyboard.tsx`** is an optional on-screen keyboard (off by default, toggled via a button in `Practice.tsx`) that mirrors `expectedPitches`/`heldPitches` (yellow/green, same scheme as the sheet) plus `wrongPitches` in red -- the only place a wrong note is ever shown in red. Its rendered range extends past `lowestPitch`/`highestPitch` to include any out-of-range wrong pitch, so a wildly wrong keypress is still visible rather than silently dropped.

### Scroll mode (`layoutMode: 'page' | 'scroll'` on `PianoScore`)

An alternative to the default paginated layout: the whole piece renders as one continuous horizontal staffline (OSMD's `renderSingleHorizontalStaffline`) that auto-scrolls sideways instead of the vertical multi-system page. Deliberately reuses `WaitEngine`/`ScoreParser`/the coloring logic completely unchanged -- only the layout and scroll direction differ. Toggling the mode remounts the whole OSMD instance (the option can only be set before `load()`), so practice progress resets to the start; this was judged an acceptable trade-off since the mode is picked once, not flipped mid-piece.

Three OSMD quirks this ran into, all silent (no exceptions, no obviously-wrong output) and worth remembering before touching this code again:
- **`g.vf-measure` DOM element count is per stave, not per measure** -- a piano score has 2 staves (treble+bass), so `querySelectorAll('g.vf-measure').length` is 2x the real measure count. `fitScrollZoom` uses `osmd.Sheet.SourceMeasures.length` instead. Getting this wrong silently computed exactly half the intended zoom.
- **`EngravingRules.SheetMaximumWidth`** (default 32767, a Canvas-backend leftover -- SVG has no such limit) caps a single horizontal staffline's total width and squishes measures toward zero width past it (visible as `SkyBottomLineCalculator: width not > 0` console warnings) instead of erroring. Any real multi-hundred-measure score zoomed in to show only a handful of measures at a time needs far more than 32767 total width, so `PianoScore` raises it (`SCROLL_MODE_SHEET_MAXIMUM_WIDTH = 300000`) before `load()` -- same load-order constraint as `renderSingleHorizontalStaffline` itself.
- **The cursor element has a CSS transition on its position** (OSMD animates it moving), so `cursorElement.getBoundingClientRect()` read right after `cursor.next()`/`cursor.show()` can capture a mid-animation (stale) value instead of the target. `scrollCursorIntoView` reads `cursorElement.style.left` instead -- a plain inline style set synchronously, unaffected by the transition's visual animation -- to compute where to scroll to.

`fitScrollZoom` picks a zoom level from two constraints and takes the *smaller* (less zoomed-in) of the two, never the bigger -- so a score's aspect ratio can leave some unused vertical room, but never clips the bottom staff out of the container (`overflow-y: hidden` in scroll mode, so anything below the container's height is just gone, not scrollable):
- width: sample the first few measures' actual on-screen width (not a whole-piece average -- the opening is usually less dense than a piece's busiest sections, so an average zoom-fit undershoots and shows more than intended right when the player starts) and zoom to fit `SCROLL_MODE_TARGET_VISIBLE_MEASURES` (4.5) of them across the container's width.
- height: zoom so the staffline fills the container's height rather than leaving blank space below it.

`scrollCursorIntoView` (scroll mode only; page mode still uses the browser's own vertical `scrollIntoView`) keeps the cursor at a fixed look-ahead position (`SCROLL_MODE_LOOKAHEAD_FRACTION`, 30% from the left edge) rather than centering it or waiting until it reaches the edge, so upcoming measures are always visible to anticipate. OSMD's own cursor-follow (which would otherwise also auto-scroll on every `cursor.next()`, gated by `CursorOptions.follow`) is explicitly disabled after load, so only this one scroll call ever drives the container -- two competing auto-scrolls fighting each other was visibly janky.

Remounting `PianoScore` (source or layoutMode change) calls `containerRef.current.replaceChildren()` before constructing a new `OpenSheetMusicDisplay` -- OSMD doesn't clear a container it didn't create itself, so without this the previous instance's SVG (same `id`, now duplicated) is left behind and `document.querySelector('svg')` silently keeps finding the stale one.

### Gamification (`ScoreHud.tsx`, `engine/grade.ts`, `engine/streakStore.ts`)

`ScoreHud` is a deliberately colorful, prominent stat strip (combo / best combo / correct notes / errors) placed directly under the title, separate from the small gray utility-controls row below it -- an earlier plain-text version ("Combo: 3" inline among the other controls) was easy to miss entirely. `currentCombo`/`maxCombo` (session-best, reported in `SessionStats`) count consecutive events completed with zero errors, reset the instant a wrong note lands (not only when the event finally advances); `correctNoteCount` counts every correct keypress, including partial chord hits, not just completed events.

`computeGrade(successPercent)` maps the existing first-try-accuracy stat to a S/A/B/C/D/F letter grade (S requires a flawless 100% run), shown on the End screen.

`streakStore.ts` is `localStorage`-backed (no account system yet, single browser/device): `recordPracticeDay()` marks today's local calendar day as practiced -- called when `Practice` mounts (session start), not only on completion, so quitting early still counts. `getStreakStats()` computes current streak (alive if the last practiced day is today or yesterday -- survives until a full day is missed), longest streak, and total days. Day-string diffs use `Date.UTC` on the parsed `YYYY-MM-DD` components rather than subtracting real (local, DST-affected) `Date` instants, so a whole-day gap always computes as exactly 1 regardless of timezone/DST.

### Training mode (`engine/sections.ts`, `PianoScore.setSectionBounds`)

Splits the piece into fixed-size chunks (`measuresPerSection`, default 8) via `computeSections`, each with a `startEventIndex`/`endEventIndex` in the same index space as `WaitEngine`/`ExpectedEvent`. `naturalBreakMeasures` (from `ScoreParser.extractNaturalBreakMeasures`, reading `SourceMeasure.rehearsalExpression` and double/final barlines) can snap a nearby fixed boundary onto an actual phrase break instead of cutting mid-phrase, within a small tolerance -- falls back to plain fixed-size chunking wherever no such marker exists (the common case). A section only auto-advances once played with zero errors `PERFECT_RUNS_TO_ADVANCE` (2) times *in a row*; any error resets that streak to 0 and repeats the same section. Manual navigation (section dropdown, Prev/Next in `Practice.tsx`) always jumps immediately, bypassing the perfect-run gate; picking up after a manual jump resumes auto-advancing in order from there. The section list's last entry is an implicit "Whole piece" choice (no bounds) -- reaching it is also where finishing the *last* real section automatically lands, so the natural flow is section-by-section drilling followed by one distinct full-piece pass, not just "the last section coincidentally reaches the end of the file."

Training mode always forces scroll layout (`layoutMode: 'scroll'`) -- there's no page-mode training.

`PianoScore.setSectionBounds(startMeasure, endMeasure)` crops rendering to that range via `EngravingRules.MinMeasureToDrawIndex`/`MaxMeasureToDrawIndex` (direct fields, not `setOptions({drawFromMeasureNumber, ...})` -- that does its own measure-number-to-index conversion that doesn't necessarily match `ExpectedEvent.measureNumber`'s own sequential scheme, and passing `undefined` to clear a bound is a no-op there, unlike setting the fields directly back to their defaults). Two non-obvious things this depends on, both found by real testing rather than reasoning about the OSMD source:
- **The cursor-position counting walk (`goToEventIndex`) must always run with NO crop active.** OSMD's own tie/rest counting only lines up with `WaitEngine`'s indices on the fully uncropped model (the one `extractExpectedEvents` originally walked) -- walking with any crop active can silently desync the two counts. The desync doesn't always show: a walk that happens to pass through the *active* crop's own drawn range along the way can still land correctly by coincidence (this is why naive "walk before applying the new crop" appeared to fix forward section-to-section jumps in initial testing), but a walk that never touches any drawn measure at all (confirmed reproducing it: jumping *backward* past a non-adjacent section) lands measures away with no highlight at all. The robust fix used everywhere sections change: **clear bounds -> walk to the target index -> apply the new crop**, every time, with no exceptions for "this jump looked safe."
- **The scroll-mode zoom is computed once from the whole (uncropped) piece and reused as-is for every section crop**, not re-fit per section -- `fitScrollZoom` samples only the currently-rendered content's own measures, so different sections (denser or sparser) settled on different zoom levels, making the staves visibly change size/position switching between them. Vertical centering has the same issue one level down: CSS `items-center` re-centers per render based on that render's own bounding box, which still varies section to section (ledger-line extremes above/below the staff differ by content) even at a fixed zoom -- so centering is applied manually (`applyStableVerticalOffset`, via the SVG's own `marginTop`) using the whole piece's own natural height as a fixed anchor, not each render's.

Un-cropping back to the whole piece (exiting training mode) rebuilds a much larger graphical model than any section-to-section change does, and `cursor.show()` alone doesn't reliably relocate onto it (found leaving the current note's highlight scrolled off-screen) -- always follow with an explicit walk to the same logical index even though it isn't changing.

### Mobile (`hooks/useIsMobile.ts`)

Mobile only ever gets scroll mode -- forced on, and the page/scroll toggle button is hidden entirely; training mode (built on scroll mode) stays available. The codebase should stay one app: use shared pages/components plus responsive classes, and branch with `useIsMobile` only where the mobile landscape layout genuinely differs. The intended use is landscape, phone-in-hand, Simply-Piano-style, so detecting "mobile" via viewport *width* alone (e.g. a `(max-width: 768px)` media query) breaks the moment the phone is rotated sideways -- width and height swap, and a phone's landscape width alone easily exceeds a portrait breakpoint (a large phone can hit ~930px landscape). `useIsMobile` instead checks `Math.min(window.innerWidth, window.innerHeight)` against the breakpoint: the physical screen's *shorter* dimension stays roughly constant across rotation, so it's what actually distinguishes a phone from a tablet/desktop.

Chrome on Android supports Web MIDI (USB-OTG or Bluetooth MIDI keyboard); Safari on iOS does not support Web MIDI at all, full stop.

### Navigation jumps ("Back to start" / "Go to measure")

`PianoScore.goToEventIndex()` does a full pass resetting every position in the piece to yellow before recoloring the target -- resetting only the pre-jump position would leave positions skipped by the jump stuck in whatever color an earlier attempt left them (this was a real bug). Jumps are an infrequent user action, so the O(n) full-piece pass is an acceptable cost; note-on handling is not.

### Testing without physical MIDI hardware

There's no MIDI test harness checked into the repo, but the pattern used during development (not committed) is worth knowing: stub `navigator.requestMIDIAccess` in a Playwright `page.addInitScript` with a fake `MIDIInput` whose `onmidimessage` is exposed on `window`, then dispatch `Uint8Array([0x90, pitch, velocity])` note-on messages through it. This drives the real `useMidi` -> `Practice` -> `WaitEngine` -> `PianoScore` pipeline end-to-end, including reaching the End screen, without a keyboard. When scripting multiple notes of a chord this way, send them back-to-back (or within `chordToleranceMs`), not spaced out with `waitForTimeout` between each, or the tolerance window resets and the chord never completes.
