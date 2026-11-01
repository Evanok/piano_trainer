# Changelog

History of shipped work on Piano Trainer, newest first. `CLAUDE.md` only describes the
current state of the project. Entries before 2026-11-01 were reconstructed
from `git log` (one line per change; the commits have the details).

Add new entries at the top: `## <Title> (YYYY-MM-DD)`.

## Deploy kit, loopback bind, data backups (2026-11-01)

- Deployment moved to the shared deploy kit (`./deploy.sh` from the dev machine): local tests/lint/build
  gate, release directories in `~/apps/piano_trainer`, atomic switch, health check, automatic rollback.
  The old on-server script is kept as `deploy/legacy_deploy.sh`.
- The server listens on `127.0.0.1` by default (`HOST`): the bare port no longer bypasses nginx/TLS.
- `deploy/backup_data.sh`: nightly tar.gz of `data/` (7 kept) mirrored to Google Drive, plus a
  `predeploy` copy before every deploy.

## Docs: production runs behind nginx (2026-11-01)

- `CLAUDE.md` and `README.md` said production was plain HTTP on a bare port with no reverse proxy. In
  reality nginx serves the app over HTTPS on a subdomain and proxies to port 5173. Docs fixed; the real
  domain and host moved to the gitignored `CLAUDE.local.md` (this repo is public).
- Known gap recorded: the server still listens on all interfaces, so the bare port stays reachable in
  plain HTTP until it is bound to `127.0.0.1` and closed in the firewall.
- History now lives in this file instead of `CLAUDE.md`.

## Stats and sheet progress (2026-10-17 to 2026-10-25)

- Stats page improvements; fixed how progress on a sheet is computed.
- Real favicon for the app (version bump to force the icon update).

## Practice calendar, daily goal, sync fixes (2026-10-15 to 2026-10-16)

- GitHub-style 365-day practice calendar; daily 20-minute goal on the home page.
- Fixed stats sync between mobile and desktop, and session metrics for page mode.
- Fixed MIDI connection lost after standby.

## UX performance pass (2026-10-13)

- Busy overlay while the score is loading or re-rendering; big round of UX performance work.
- Exercise page settings remembered per device; MIDI player fixed in loop mode; unused metrics removed.

## Chord-reading drill (2026-09-08 to 2026-10-01)

- New chord exercise (level 1), then reworked from scratch and iterated on the desktop layout.
- Both clefs, accidentals, random keys and catalog chords as material; augmented chord bug fixed.
- Catalog: key signature filter.

## Reading drills and catalog upgrade (2026-08-30 to 2026-09-01)

- Sight-reading quiz (note names or virtual keyboard answers), with its own stats section.
- Note-order drill; shuffled name buttons; back button restores the exercise tab and settings.
- Catalog: new filter system; app versioning.
- Fingering shown on the virtual keyboard; clearer left/right hand colors.

## Virtual keyboard rework and scroll loop (2026-08-27)

- Virtual keyboard redesign (fixed scale, zoom and focus area, hand visibility).
- New scroll loop mode to drill a chosen range of measures.

## Guest mode, security and bandwidth (2026-08-25)

- Read-only guest links; catalog improvements; mobile long press to jump to a measure; favorites.
- Login throttling; only trust `X-Forwarded-For` from the local reverse proxy.
- Debug panel hidden in production; no backing tracks for guests; gzip responses.

## Stats rework and password gate (2026-08-16 to 2026-08-18)

- Stats system rewritten (session log, completion per sheet, sessions per week).
- API password gate; fixed an HTTP vs HTTPS production issue (secure-context APIs).
- One-hand practice (left/right); difficulty metadata and filter in the catalog.
- Screen kept awake during practice; MIDI file playback; option to hide the virtual keyboard on mobile.
- Page free mode no longer tracks notes; scroll mode by default on mobile.

## Catalog, mobile, exercises, Hanon (2026-07-29 to 2026-08-15)

- Score catalog (upload, search, edit, delete).
- Mobile support; navigation improvements.
- Generated exercises (v1) and first Hanon generator.

## First MVP (2026-07-25 to 2026-07-26)

- Wait-mode practice on a MusicXML score with a MIDI keyboard, live note coloring.
- Virtual keyboard helper, auto-scroll mode, first gamification (combo, grade).
- Section training mode inspired by Simply Piano.

