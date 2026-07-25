# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` -- start the Vite dev server (port 5173 by default)
- `npm run build` -- typecheck (`tsc -b`) then production build
- `npm test` -- run the vitest suite once
- `npx vitest run src/engine/WaitEngine.test.ts` -- run a single test file
- `npx tsc -b --noEmit` -- typecheck only, no build output
- `npm run lint` -- oxlint

There is no test runner watch mode wired up as a script; use `npx vitest` (no `run`) directly for watch mode.

## What this is

A piano practice web app ("Wait Mode", Simply-Piano-style): load a MusicXML/`.mxl` score, connect a MIDI keyboard, and the score only advances when the correct note(s)/chord are played -- no tempo pressure, no audio playback. Founding brief and full feature roadmap: see memory/project context from prior sessions (not duplicated here since it evolves independently of the code).

## Architecture

### Data flow

`Home` (file picker + MIDI device picker, using `useMidi`) -> `App` holds the loaded `File` and switches screens (`home` / `practice` / `end`, plain `useState`, no router) -> `Practice` wires everything together -> `End` shows session stats. `useMidi` is instantiated once in `App` (not per-screen) so the Web MIDI permission prompt only fires once per session and device state survives screen switches.

### The core pipeline (`src/engine/`, `src/components/PianoScore.tsx`)

1. **`ScoreParser.extractExpectedEvents(osmd)`** walks the OSMD cursor once and produces a flat `ExpectedEvent[]` (`{ index, pitches, measureNumber }`), one entry per playable position (a single note or a chord). It filters out two kinds of cursor positions that must NOT require a keypress:
   - rests
   - tie continuations (`isTieContinuation`, exported from this file) -- a tied note sustains, it isn't re-struck. `PianoScore.tsx`'s cursor-stepping (`next()`, `goToEventIndex()`) uses the same `requiredNotesUnderCursor()` filter to stay index-aligned with this list; if that filter ever drifts out of sync between the two, the OSMD cursor and the WaitEngine's `currentIndex` desync and note coloring silently breaks (nothing colors at all) even though playback logic still advances correctly.
   - `noteToMidi(note)` converts OSMD's `Note.halfTone` to a standard MIDI number (`halfTone + 12`) -- do not reconstruct pitch from `Pitch.Octave` directly, it uses a different internal octave convention (`Pitch.OctaveXmlDifference`) than the MusicXML octave and will be off by whole octaves.

2. **`WaitEngine`** is a pure, DOM-free state machine: `noteOn(pitch, timestamp)` returns `'waiting' | 'error' | 'done'`. Chord notes can be played in any order, held together within `chordToleranceMs` (`DEFAULT_CHORD_TOLERANCE_MS`, 2000ms) of the first note of the attempt; a correct note arriving after that window expires the earlier ones (fresh attempt, not accumulated). A wrong note always fully clears held progress immediately, regardless of timing. `expireStaleHold(now)` lets a UI timer proactively expire a stale hold (rather than only checking lazily on the next keypress) so the screen can visually decay even when the user just pauses.

3. **`PianoScore`** (imperative handle via `forwardRef`) owns the live `OpenSheetMusicDisplay` instance and all note-coloring. Colors are the three-state scheme: yellow (`#eab308`, not attempted), green (`#22c55e`, correct -- persists permanently once completed, `next()` never resets it), red (`#ef4444`, "urgent" -- shown on not-yet-held notes right after any keypress, right or wrong; decays back to yellow via `Practice.tsx`'s timer). Coloring is done directly on SVG elements (`colorNotes`/`tryColorNoteFast`), not by calling `osmd.render()` per keystroke -- a full render() took ~370ms on a large real-world score. Two non-obvious things this depends on:
   - a chord's notes share one VexFlow SVG group; `vfnoteIndex` picks the correct notehead within it
   - the notehead's own child `<path>` carries its own explicit `fill` that overrides the parent group's -- both must be set
   - some notes (seen on complex real scores) have no resolvable graphical reference via the fast path; `colorNotes` falls back to `note.NoteheadColor` + a single batched `render()` for just those, so correctness never depends on the fast path succeeding.

4. **`Practice.tsx`** is the glue: subscribes to `useMidi`'s note-on stream, feeds `WaitEngine.noteOn()`, and drives `PianoScore`'s imperative methods (`next()`, `syncNotes(heldPitches, urgent)`, `goToEventIndex()`) plus the decay timer described above. It also tracks session stats (`SessionStats`): `successPercent` is first-try accuracy (percentage of events with zero wrong presses before completion), not `(total-errors)/total`, which can go negative if one event is retried many times.

### Navigation jumps ("Back to start" / "Go to measure")

`PianoScore.goToEventIndex()` does a full pass resetting every position in the piece to yellow before recoloring the target -- resetting only the pre-jump position would leave positions skipped by the jump stuck in whatever color an earlier attempt left them (this was a real bug). Jumps are an infrequent user action, so the O(n) full-piece pass is an acceptable cost; note-on handling is not.

### Testing without physical MIDI hardware

There's no MIDI test harness checked into the repo, but the pattern used during development (not committed) is worth knowing: stub `navigator.requestMIDIAccess` in a Playwright `page.addInitScript` with a fake `MIDIInput` whose `onmidimessage` is exposed on `window`, then dispatch `Uint8Array([0x90, pitch, velocity])` note-on messages through it. This drives the real `useMidi` -> `Practice` -> `WaitEngine` -> `PianoScore` pipeline end-to-end, including reaching the End screen, without a keyboard. When scripting multiple notes of a chord this way, send them back-to-back (or within `chordToleranceMs`), not spaced out with `waitForTimeout` between each, or the tolerance window resets and the chord never completes.
