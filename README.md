# Piano Trainer

A "Wait Mode" piano practice web app, Simply-Piano-style: load a MusicXML or `.mxl` score, connect a USB/MIDI keyboard, and the score only advances when you play the correct note(s)/chord. No tempo pressure, no composition features -- practice only.

## Stack

React + TypeScript + Vite + Tailwind CSS. No backend. Score rendering via [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay), keyboard input via the Web MIDI API (Chrome/Edge only -- Firefox and Safari/iOS don't support it).

## Getting started

```bash
npm install
npm run dev
```

Open the printed local URL in Chrome or Edge, pick a `.musicxml`/`.xml`/`.mxl` file, connect your MIDI keyboard, and start playing.

## Scripts

- `npm run dev` -- dev server
- `npm run build` -- typecheck + production build
- `npm test` -- run the test suite
- `npm run lint` -- oxlint

See `CLAUDE.md` for the internal architecture (score parsing, the wait engine, MIDI handling, note coloring).
