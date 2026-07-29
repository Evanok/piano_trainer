# Piano Trainer

A "Wait Mode" piano practice web app, Simply-Piano-style: load a MusicXML or `.mxl` score, connect a USB/MIDI keyboard, and the score only advances when you play the correct note(s)/chord. No tempo pressure, no composition features -- practice only.

## Stack

React + TypeScript + Vite + Tailwind CSS, plus a minimal `node:http` backend (no framework, no database) that stores the score catalog. Score rendering via [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay), keyboard input via the Web MIDI API (Chrome/Edge only -- Firefox and Safari/iOS don't support it).

## Getting started

```bash
npm install
npm run dev
```

Open the printed local URL in Chrome or Edge, pick a `.musicxml`/`.xml`/`.mxl` file, connect your MIDI keyboard, and start playing.

## Score catalog

Every score you upload is saved server-side, so you never have to re-pick the same file twice: the home page lists the catalog (10 most recently uploaded per page, with a search box), and picking an entry loads it straight into practice.

Scores are listed under their real title and composer, read from the MusicXML itself (`.mxl` files are unzipped to get at it) rather than under their file name. A score whose metadata is empty falls back to a readable form of the file name, and the search box matches title, composer and file name.

Uploads land in `data/` next to the repo (gitignored):

```
data/
  catalog.json          index: id, title, filename, size, upload date
  scores/<uuid>.mxl     the files themselves
```

Set `PIANO_TRAINER_DATA_DIR` to store them elsewhere (recommended on a real deployment, so a redeploy of the code never touches the scores).

## Deployment

```bash
npm run build
npm start            # PORT=4173 by default
```

`npm start` serves the built front-end from `dist/` and the catalog API from the same port. In development the very same API handler is mounted on the Vite dev server (see `vite.config.ts`), so `npm run dev` stays a single process and dev/production can't drift apart.

## Scripts

- `npm run dev` -- dev server (front-end + catalog API)
- `npm run build` -- typecheck + production build
- `npm start` -- production server (serves `dist/` + the catalog API)
- `npm test` -- run the test suite
- `npm run lint` -- oxlint

See `CLAUDE.md` for the internal architecture (score parsing, the wait engine, MIDI handling, note coloring).
