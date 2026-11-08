# Changelog

History of shipped work on Piano Trainer, newest first. `CLAUDE.md` only describes the
current state of the project. Entries before 2026-11-01 were reconstructed
from `git log` (one line per change; the commits have the details).

Add new entries at the top: `## <Title> (YYYY-MM-DD)`.

## Combo counter over the score (2026-11-08)

- `ComboOverlay`: the live combo drawn big over the top-right corner of the score, in every mode except Page
  free, on desktop and mobile. It pops on every event, changes hue at 10/25/50 (shimmering from 50), sends a
  ring every 10, shows "New best" when a run beats an earlier one, and the broken number falls struck through
  when a run ends on a wrong note. CSS animations only, off under reduced motion.
- The desktop stat strip (`ScoreHud`) drops its Combo tile, which the overlay now replaces.

## Sudden death mode (2026-11-08)

- New practice mode "Sudden death": the scroll layout over the whole piece, where any wrong note sends the
  cursor back to the first note. A message names the measure, the run that was lost and the best run.
- The combo now counts per attempt: an event missed in an earlier pass counts again once replayed cleanly
  (it never did before, which also stalled the combo in Scroll loop). First-try accuracy is unchanged.

## Section modes removed (2026-11-08)

- "Section free" and "Section training" are gone: in practice only Page free, Scroll loop and a little Scroll
  were used, and the loop covers drilling a passage with a range the player picks. Removed with them:
  `computeSections`, `extractNaturalBreakMeasures`, the section picker, prev/next and measures-per-section
  controls. `sectionForMeasureRange` and the crop machinery stay, the loop runs on them. Old session records
  keep their mode labels in Stats.

## Catalog "last played" up to date after practice (2026-11-08)

- The catalog's progress and "last played" order come from the server's `stats.json`, but a session is only
  written to the device's own log, which was pushed only when Home or Stats opened. Going straight from a
  piece back to the catalog therefore showed stale values. `ScoreLibrary` now syncs the local log before its
  first listing (owner only, a failed sync does not block the listing).

## Playback preview follows hand mode (2026-11-08)

- The "Play" preview used to play both hands whatever the hand mode. Practising one hand, it now plays that
  hand only, through the same staff choice as the practice filter (`targetStaffForHand`, now exported), so a
  score with no unambiguous pair of hands still plays everything.

## Faster deploys: dependency reuse (2026-11-01)

- `deploy.conf` splits `INSTALL_CMD` (npm ci) from `REMOTE_BUILD`; with `REUSE_DEPS`, the deploy kit copies the
  live release's `node_modules` when the lock, the `package.json` files and the node version are unchanged.

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

