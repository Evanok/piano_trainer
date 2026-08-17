# Piano Trainer

A "Wait Mode" piano practice web app, Simply-Piano-style: load a MusicXML or `.mxl` score, connect a USB/MIDI keyboard, and the score only advances when you play the correct note(s)/chord. No tempo pressure, no composition features -- practice only.

## Stack

React + TypeScript + Vite + Tailwind CSS, plus a minimal `node:http` backend (no framework, no database) that stores the score catalog. Score rendering via [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay), keyboard input via the Web MIDI API (Chrome/Edge only -- Firefox and Safari/iOS don't support it).

## Getting started

```bash
npm install
npm run dev
```

Open the printed local URL in Chrome or Edge, connect your MIDI keyboard, then choose Exercise, Practice a score, or Stats from the home screen.

## Navigation and mobile use

The home screen intentionally stays small: Exercise opens the generated-exercise setup page, Practice a score opens upload plus catalog, and Stats shows local exercise history. Practice itself is shared by both playable flows. On phone-sized screens the practice view is designed for landscape use and forces horizontal scroll mode; regular scores keep the virtual keyboard visible as a compact aid, while generated exercises hide it so it does not give away the answer.

## Score catalog

Every score you upload from Practice a score is saved server-side, so you never have to re-pick the same file twice: that page lists the catalog (10 most recently uploaded per page, with a search box), and picking an entry loads it straight into practice.

Scores are listed under their real title and composer, read from the MusicXML itself (`.mxl` files are unzipped to get at it) rather than under their file name. A score whose metadata is empty falls back to a readable form of the file name, and the search box matches title, composer and file name.

Uploads land in `data/` next to the repo (gitignored):

```
data/
  catalog.json          index: id, title, filename, size, upload date
  scores/<uuid>.mxl     the files themselves
```

Set `PIANO_TRAINER_DATA_DIR` to store them elsewhere (recommended on a real deployment, so a redeploy of the code never touches the scores).

## Generated training

The Exercise page generates a short training exercise without uploading a score. Pick the hand setup, exercise type (notes, triads, or mixed), octave range, accidental mode, difficulty and length; the app builds a MusicXML file in memory and opens it through the same Practice pipeline as a normal score. The generator favours small melodic motion, phrase endings on stable scale tones, key signatures, and simple left-hand accompaniment instead of pure random notes. Single-hand exercises can drill notes, triads, or alternating measures of both; two-hand exercises keep the right hand as melody and apply the notes/triads/mixed choice to the left-hand accompaniment. Generated exercises are not saved to the catalog.

## Deployment

Piano Trainer is served **directly on port 5173** of the VPS it is deployed to.
There is no Nginx or reverse proxy in this deployment, and no TLS: the address is
`http://<vps-host>:5173/`. Set `PIANO_TRAINER_PUBLIC_URL` if you want
`deploy.sh` to print the real one.

Because the port is public and there is no proxy in front of it, set
`PIANO_TRAINER_PASSWORD` on the production server. Without it the whole API is
open to anyone who can reach the port: the practice history can be read, scores
can be uploaded or deleted, and stats can be overwritten. The password is asked
once per device. It travels unencrypted over plain HTTP, so it guards against
passers-by and bots, not against someone able to sniff the network.

Use the repository's deployment script. It manages the two PM2 processes and
prevents them from fighting over port 5173:

```bash
# On the VPS: set the API password, then install, build and expose the app.
export PIANO_TRAINER_PASSWORD='something-long'
./deploy.sh prod start

# Stop the public production server.
./deploy.sh prod stop

# On a development machine: start Vite on localhost only.
./deploy.sh dev start

# Stop the local development server.
./deploy.sh dev stop
```

To deploy the latest committed version on the VPS, first update the checkout,
then run the production command:

```bash
git pull --ff-only
./deploy.sh prod start
```

Production runs directly on `0.0.0.0:5173`; development is deliberately bound
to `127.0.0.1:5173`. Ensure the VPS/firewall permits incoming TCP on port 5173.

In development the same API handler is mounted on the Vite dev server (see
`vite.config.ts`), so `npm run dev` stays a single process and dev/production
cannot drift apart.

## Scripts

- `npm run dev` -- dev server (front-end + catalog API)
- `npm run build` -- typecheck + production build
- `npm start` -- production server on port 5173 (serves `dist/` + the catalog API)
- `./deploy.sh dev|prod start|stop` -- start or stop the corresponding managed server
- `npm test` -- run the test suite
- `npm run lint` -- oxlint

See `CLAUDE.md` for the internal architecture (score parsing, the wait engine, MIDI handling, note coloring).
