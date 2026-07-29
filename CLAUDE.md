# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` -- start the Vite dev server (port 5173 by default); the catalog API is mounted on it, so this is still a single process
- `npm run build` -- typecheck (`tsc -b`) then production build
- `npm start` -- production server: serves `dist/` + the catalog API (`PORT`, default 4173)
- `npm test` -- run the vitest suite once
- `npx vitest run src/engine/WaitEngine.test.ts` -- run a single test file
- `npx tsc -b --noEmit` -- typecheck only, no build output
- `npm run lint` -- oxlint

There is no test runner watch mode wired up as a script; use `npx vitest` (no `run`) directly for watch mode.

## What this is

A piano practice web app ("Wait Mode", Simply-Piano-style): load a MusicXML/`.mxl` score, connect a MIDI keyboard, and the score only advances when the correct note(s)/chord are played -- no tempo pressure, no audio playback. Founding brief and full feature roadmap: see memory/project context from prior sessions (not duplicated here since it evolves independently of the code).

## Architecture

### Data flow

`Home` (file picker + MIDI device picker + score catalog, using `useMidi`) -> `App` holds the loaded `File` and switches screens (`home` / `practice` / `end`, plain `useState`, no router) -> `Practice` wires everything together -> `End` shows session stats. `useMidi` is instantiated once in `App` (not per-screen) so the Web MIDI permission prompt only fires once per session and device state survives screen switches.

### Score catalog (`server/`, `src/api/catalog.ts`)

The only server-side part of the app: uploaded scores are kept on disk so they can be re-opened later without re-picking the file. Deliberately dependency-free (`node:http` + `node:fs`, no framework, no database) -- it's a single-user personal deployment, not a service.

- **One handler, two hosts.** `createCatalogApi()` (`server/catalogApi.ts`) is a connect-style middleware. In dev, `vite.config.ts` mounts it on the Vite dev server (so `npm run dev` stays one process); in production `server/index.ts` mounts it in front of a static `dist/` file server. There is no second implementation of the endpoints to keep in sync, and no dev-only proxy config.
- **Endpoints:** `GET /api/scores?q=&page=&limit=` (search + pagination, most recent first), `POST /api/scores?filename=` (the file is the raw request body -- posting `multipart/form-data` instead would mean shipping a parser for no benefit), `GET /api/scores/:id/file`.
- **Storage** (`server/catalogStore.ts`): `<dataDir>/catalog.json` + `<dataDir>/scores/<uuid><ext>`, where `dataDir` is `PIANO_TRAINER_DATA_DIR` or `./data`. Resolved from `process.cwd()` on purpose, *not* from `import.meta.url`: in dev this module is bundled into a temporary Vite config file at an unrelated path, which would silently move the data directory. `data/` is gitignored, and lives outside `public/` so Vite never serves it statically -- `server.watch.ignored` also excludes it, otherwise every upload would trigger a full page reload and drop a practice session in progress.
- **The stored file name is always `<generated uuid><ext>`**, never the uploaded name, so a crafted filename can't escape the scores folder; ids coming back in a URL are checked against a UUID pattern before touching the filesystem. `catalog.json` is written tmp-then-rename, and a corrupt `catalog.json` throws instead of being read as an empty list (an empty list would be overwritten by the next upload, losing every entry while the score files are still on disk).
- **`downloadScoreFile()` rebuilds a real `File` with the original filename** (`new File([blob], entry.filename)`) before handing it to `App`/`Practice`. The name matters: OSMD decides whether to unzip (`.mxl`) or parse XML from it, so a catalog score has to reach `PianoScore` exactly as a freshly picked file would. Everything downstream of `onFileLoaded` is unchanged and can't tell the two apart.
- **Upload failure doesn't block practice.** `Home` awaits the upload before switching screens, and on failure shows the error plus a "practice without saving it" button -- an unreachable catalog degrades to the old behaviour rather than either blocking the session or silently losing the score.

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

### Navigation jumps ("Back to start" / "Go to measure")

`PianoScore.goToEventIndex()` does a full pass resetting every position in the piece to yellow before recoloring the target -- resetting only the pre-jump position would leave positions skipped by the jump stuck in whatever color an earlier attempt left them (this was a real bug). Jumps are an infrequent user action, so the O(n) full-piece pass is an acceptable cost; note-on handling is not.

### Testing without physical MIDI hardware

There's no MIDI test harness checked into the repo, but the pattern used during development (not committed) is worth knowing: stub `navigator.requestMIDIAccess` in a Playwright `page.addInitScript` with a fake `MIDIInput` whose `onmidimessage` is exposed on `window`, then dispatch `Uint8Array([0x90, pitch, velocity])` note-on messages through it. This drives the real `useMidi` -> `Practice` -> `WaitEngine` -> `PianoScore` pipeline end-to-end, including reaching the End screen, without a keyboard. When scripting multiple notes of a chord this way, send them back-to-back (or within `chordToleranceMs`), not spaced out with `waitForTimeout` between each, or the tolerance window resets and the chord never completes.
