# Automatic difficulty grade

Working document for IDEA.md section 4 ("An automatic difficulty grade for a
score"). Records what was found while investigating PianoML's grading system,
what it can and cannot answer, and the plan. Nothing here is built yet.

## Goal

A **second, parallel** difficulty signal, derived automatically from the score
itself. It does **not** replace `CatalogEntry.difficulty`
(`easy | medium | hard`), which stays user-assigned and authoritative wherever
it is set. The new value is a derived field (working name `autoGrade`), so a
freshly uploaded score arrives with a level instead of waiting to be tagged by
hand, and the catalog can eventually be filtered by "what can I actually play
right now".

Not to be confused with `computeGrade(successPercent)` (`src/engine/grade.ts`),
which grades *a performance* (S/A/B/C/D/F), not a piece.

## Where PianoML's grade actually comes from

The grade is **not** in the `piano-ml` repository:

- `backend/scripts/get_metadata.py` -> `extract_grade()` only shells out to
  `piano-syllabus-classifier/inference.py --midi_file ... --model_dir ps_model`
  and reads `predicted_value` from its stdout.
- The Java backend computes nothing; `ScoreService` just parses the `"grade"`
  field out of the `metadata.json` produced by that script, stores it as a
  `Float` on `Score`, and exposes it for filtering/sorting.
- The real code lives in a separate public repo,
  **github.com/piano-ml/piano-syllabus-classifier**, cloned by their backend
  `Dockerfile` and gitignored from the backend tree.

Their full ingest path is `musicxml2pack.sh`: MuseScore 3 CLI normalises the
MusicXML, `get_metadata.py` extracts metadata, MuseScore renders a `.midi`, and
the grade is predicted from that MIDI.

## What the classifier is

Public, weights included (not just training code).

- **18 handcrafted features** (`features.py`, ~200 readable lines), extracted
  from MIDI with `symusic`.
- **Ensemble**: an MLP (18 -> 64 -> 32) with a CORN ordinal head (9 classes),
  17 KB of safetensors, plus a LightGBM regressor (383 trees x 31 leaves,
  1.1 MB as text). Weighted average, `mlp_weight = 0.25`.
- **Output**: a continuous value on the PianoSyllabus scale, roughly 1..8
  (their sample metadata: `"grade": 4.821`), rounded and clamped to 1..8 for a
  label. Original grades 9-10 are merged into 8.
- **Reported accuracy** (their own README, on their test set): MAE 0.79 grade,
  46.96% exact accuracy, macro F1 0.42. Confusions are almost all with adjacent
  grades.

Feature importance (LightGBM): `num_distinct_pitches` dominates by a wide
margin, then `repeated_note_ratio` and `max_polyphony`, then chord ratio, pitch
range and note density. `wide_leap_ratio` is negligible.

## The 18 features, against the criteria that matter to us

| Criterion | Covered? | How |
|---|---|---|
| Note density | yes | `note_density` (notes per second, using the first tempo only) |
| Chords vs single notes | yes | `chord_ratio`, `avg_polyphony`, `max_polyphony`, `polyphony_entropy` |
| Several octaves used | yes | `pitch_range`, `num_distinct_pitches` (the single most important feature) |
| Fast rhythm | yes | `fast_note_ratio` (shorter than an eighth), plus `note_density` |
| Simultaneous LH/RH notes | crude | no notion of hands at all: all tracks are merged, and `hand_independence` is just `abs(mean(pitches < C4) - mean(pitches >= C4)) / 24`. A fixed C4 split, not the actual staves |
| Complex patterns | crude | only `arpeggio_ratio` (a windowed heuristic) and `rhythmic_complexity` (normalised std of inter-onset intervals). No motif, sequence or polyrhythm detection |
| Large geographical leaps | effectively no | `wide_leap_ratio` is computed on **sorted** pitches, so it measures gaps in the set of pitches used, not melodic leaps. Consistent with it being the least important feature |
| Key signature / number of sharps | **impossible** | MIDI carries no spelling. C# and Db are the same number; a piece in B major and the same piece transposed to C major produce an identical feature vector and therefore an identical grade |
| Tempo marking | indirect only | only through `note_density`, and only the *first* tempo event is read |
| Chord span / stretch | no | only the *number* of simultaneous notes, never their spread in semitones |
| Fingering, hand crossing, ornaments, pedal, articulation, written dynamics, time signature, tuplets, bar lines | no | none of these exist in the feature set |

Three of the 18 features are velocity-based (`avg_velocity`, `std_velocity`,
`dynamic_range`), which MusicXML does not carry.

Two of the features are, strictly speaking, buggy: `wide_leap_ratio` and
`repeated_note_ratio` both operate on sorted pitches, so neither measures what
its name says. If we port the model as-is, **the bugs must be ported too** --
the weights were trained with them.

## The honest ceiling

The whole research field sits around 40-47% exact accuracy on this task. The
best published model on CIPI (below) reports 39.5% balanced accuracy and a
median square error of 1.1 across nine levels. This is not a sign that PianoML
did a poor job; the task is intrinsically fuzzy, since two teachers do not
assign the same grade to the same piece.

The realistic target is therefore **never being wrong by more than one grade**,
not predicting the exact grade.

This is also the argument for reusing a trained model rather than writing our
own weighted heuristic: a hand-tuned formula with thirty well-chosen criteria
but invented weights can easily be worse, and we would have no way of knowing.
The value in PianoML's model is not the richness of its features -- they are
poor -- but that they were calibrated against thousands of pieces graded by
humans.

## Datasets

**PSyllabus** (Zenodo 14794592) -- what PianoML trained on.
- 7,901 solo piano pieces, 1,233 composers, 11 levels, labels from real
  syllabi (ABRSM, RCM, Trinity).
- The content is **audio recordings** (YouTube links); the distributed
  `mid.zip` (52 MB) is MIDI **transcribed from human performances**. There are
  no scores in it. So no key signature, no staves, no bar lines -- it can never
  train the criteria we care about most.
- The Zenodo license field says CC-BY-4.0 while the description says "Research
  use only". Contradiction worth noting.

**CIPI** (Zenodo 8037327) -- the one we would actually want.
- ~650 public-domain piano scores in **MusicXML**, graded 1-9 by Henle Verlag,
  reviewed by an expert pianist.
- Access is **restricted**: request from pedro.ramoneda@upf.edu (UPF
  Barcelona, same group as PSyllabus).
- Small enough that overfitting is a real concern -- cross-validation and few
  features.

**ASAP** (github.com/fosfrancesco/asap-dataset) -- the measuring instrument.
- 222 scores, 15 composers, ~80 MB, each piece provided as `xml_score.musicxml`
  **and** `midi_score.mid` (the same score quantised onto the metrical grid)
  **and** one or more human performance MIDIs, aligned to ~3 ms.
- No LICENSE file (`NOASSERTION` on GitHub). Used locally for measurement only;
  nothing from it enters this repo or the app.

## Known problems to solve

1. **MIDI in, MusicXML out.** PianoML converts MusicXML to MIDI with MuseScore
   before extracting features. We would extract features straight from
   MusicXML, which means writing a real note-level MusicXML parser server-side
   (divisions, backup/forward, chords, staves, ties, tempo) -- `server/
   scoreMetadata.ts` is regex over three flat elements, nowhere near enough.

2. **No velocity in MusicXML.** The normaliser shows real variance in the
   training set (`std_velocity` mean 13.4, `dynamic_range` mean 74.6), because
   the training MIDI comes from human performances. Feeding constants would put
   those features far outside the trained range (LightGBM's own
   `feature_infos` bound them at about -4.4 and -5.5 sigma). Substituting the
   training mean (z = 0) is the least-bad fix if we port as-is.

3. **Domain gap, quantised score vs human performance.** This is the bigger
   risk and PianoML does not address it either: their model was trained on
   performance transcriptions but is applied to MuseScore-rendered MIDI. Timing
   features (`rhythmic_complexity`, inter-onset statistics, and to a degree
   `note_density`) will read systematically differently on quantised notation.
   **This is what step 1 measures.**

4. **Licensing.** `piano-syllabus-classifier` has **no LICENSE file** (so, all
   rights reserved by default), while `piano-ml` itself is GPL-3.0. Vendoring
   their weights into this public repo needs either the author's agreement, or
   fetching the weights at deploy time without committing them (what their own
   Dockerfile does), or training our own.

## Rejected: training on our own practice history

Considered and dropped. The production server holds roughly three hours of
recorded practice, from a single self-taught beginner with seven years of
guitar behind them. Volume aside, the profile is not representative: rhythm
reading and harmonic understanding are already strong while hand independence
and bass-clef reading are not, so the data would describe one atypical player
rather than the difficulty of any piece. It is not usable for training and not
usable for recalibrating either.

## Plan

**Step 1 -- measure the domain gap (the decision point).**
Clone ASAP, install `symusic`, and run PianoML's own `features.py` twice per
piece: once on `midi_score.mid` (quantised notation, i.e. what we would
produce from MusicXML) and once on a human performance MIDI (same domain as
PSyllabus). Same piece, both domains, 222 samples. Compare the 18 features,
paying attention to the timing-sensitive ones.

- Small shift -> a model trained on PSyllabus is usable on our scores.
- Large shift (about a standard deviation or more) -> training on PSyllabus is
  a dead end for us and CIPI becomes the prerequisite.

**Step 2 -- request CIPI, in parallel.** Free, no commitment, and it is the
only path to a model that actually sees key signature, real hands and chord
spans. Worth sending whatever step 1 concludes.

**Step 3 -- train our own weights** (on PSyllabus or CIPI, depending on step 1).
Cheap: LightGBM on 7,900 x 18 trains in seconds on CPU, the MLP in minutes. No
GPU. Training our own also settles three things at once: it removes the
licensing grey area, it lets us drop the three velocity features outright
instead of faking them at inference, and it lets us fix the two sorted-pitch
bugs instead of reproducing them. Baseline to beat: MAE 0.79.

**Step 4 -- port inference to TypeScript, server-side only.** The MLP is three
matrices plus a frozen BatchNorm and a cumulative sigmoid; LightGBM inference
is a numeric-threshold tree walk, with the text model precompiled once into
compact JSON. No new runtime dependency, no Python on the VPS, and no browser
bundle cost since it runs at upload time.

Validation for the port comes free from ASAP: our TypeScript features computed
from `xml_score.musicxml` should match the Python features computed from the
same piece's `midi_score.mid`. Any difference there is our parser's fault
rather than a domain effect. BWV 846 is in both ASAP and the local catalog, so
one piece can be checked end to end.

**Step 5 -- wire it into the catalog.** Follow the existing
`server/scoreMetadata.ts` pattern: compute at upload, store `autoGrade` as a
derived field next to (never overwriting) `difficulty`, and bump
`METADATA_VERSION` so every score already in the catalog is re-graded without
being re-uploaded.

**Step 6, optional -- our own MusicXML-native signals alongside.** Key
signature, real per-hand simultaneity from the staves, true melodic leaps per
hand, chord span in semitones. Displayed as an explanation of the grade rather
than folded into it, because mixing a calibrated number with invented weights
loses the calibration. Folding them in properly means retraining on CIPI.
