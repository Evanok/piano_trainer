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

## Step 1 results: the domain gap is real but small, and avoidable

Measured on ASAP, 235 pieces, each scored twice with PianoML's own
`features.py`: once from `midi_score.mid` (quantised notation) and once from a
human performance of the same piece. Deltas below are in units of the
PSyllabus training standard deviation, which is the scale the model sees after
normalisation.

**Domain-invariant (delta under 0.15 sigma, essentially zero):**
`pitch_range`, `num_distinct_pitches`, `repeated_note_ratio`, `wide_leap_ratio`,
`avg_polyphony`, `max_polyphony`, `polyphony_entropy`, `low_ratio`,
`high_ratio`, `hand_independence`. Notably these include the three most
important features of the LightGBM model (`num_distinct_pitches`,
`repeated_note_ratio`, `max_polyphony`).

**Domain-sensitive:**

| Feature | Mean delta (sigma) | Pieces over 1 sigma |
|---|---|---|
| `dynamic_range` | -2.62 | 77% |
| `rhythmic_complexity` | -1.37 | 71% |
| `avg_velocity` | +1.29 | 62% |
| `arpeggio_ratio` | +1.22 | 51% |
| `std_velocity` | +0.14 (median abs 2.78) | 78% |
| `chord_ratio` | +0.75 | 21% |
| `note_density` | +0.54 | 39% |
| `fast_note_ratio` | +0.32 | 21% |

The velocity block behaves exactly as expected. `rhythmic_complexity` confirms
the prediction: 0.61 on notation against 1.39 on performance, since rubato
inflates the spread of inter-onset intervals. `chord_ratio` drops on
performance because a human does not strike a chord's notes on the same
millisecond. `note_density` differs because performers do not play at the
notated tempo.

**At the level that actually matters, the predicted grade:**

- mean absolute difference **0.354 grade**, bias -0.07 (so noise, not a
  systematic shift), correlation 0.838, only 5% of pieces off by more than a
  full grade.
- That is comfortably below the model's own error on its own test set
  (MAE 0.79). The domain gap is not the dominant error term.

**Two caveats.** ASAP is virtuoso competition repertoire: the predicted grades
cluster at the top (mean 6.94, and 28 of 235 pieces hit the 8 ceiling from
notation), which mechanically compresses differences. Restricting to pieces
under grade 7 raises the gap to 0.494 mean absolute with 14% over a full grade.
And ASAP contains essentially nothing at grades 1-4, which is exactly the range
a beginner's catalog lives in, so that range remains unmeasured.

**Dropping the domain-sensitive features closes the gap almost entirely.**
Simulated by pinning them to the training mean on both sides:

| Features neutralised | Mean abs delta | Over 1 grade | Correlation |
|---|---|---|---|
| none (baseline) | 0.354 | 5% | 0.838 |
| velocity (3) | 0.317 | 3% | 0.902 |
| + timing (`rhythmic_complexity`, `arpeggio_ratio`) | 0.272 | 2% | 0.919 |
| + density (`note_density`, `chord_ratio`, `fast_note_ratio`) | 0.110 | 0% | 0.988 |

So a model trained on the 10 domain-invariant features would be near-immune to
the notation/performance difference, and those ten include the ones the model
leans on most. What that costs in raw accuracy is unknown until we retrain and
compare; that is the ablation in step 3.

**Verdict: PSyllabus is usable.** Training on it is not a dead end, provided
the feature set is chosen for domain invariance rather than copied wholesale.
CIPI remains the only route to grading on key signature, real hands and chord
spans, but it is no longer a prerequisite.

## Reality check: the model against our own easy/medium/hard labels

The catalog synced from production carries 99 scores, 98 of them hand-labelled
(36 easy / 47 medium / 15 hard). Converting each one to MIDI with music21 (the
same way PianoML's `convert.py` does) and running their shipped model gives:

- **Spearman(manual label, model grade) = 0.315.** Weak.
- **Spearman(manual label, raw note count) = 0.434.** The plain number of notes
  in the file predicts the labels *better* than the model does.
- **Spearman(model grade, raw note count) = 0.863.** On this repertoire the
  model is largely a note-count proxy.

Five scores could not be converted (music21 raised on malformed repeats, one on
an infinite value), which is worth remembering as a general robustness note
about real-world MusicXML.

The disagreements are systematic rather than random, and they split cleanly in
two:

- Labelled **easy**, graded 5-6: Hania Rani's "F Major", Radiohead's
  "Daydreaming", Bach BWV 999 and BWV 846. All long and note-dense, but built
  on one repeated figure -- learn a bar, play the piece.
- Labelled **hard**, graded 1.5-2.8: "En therapie", "Ramona", "Branches Break",
  "Sweden v2". All sparse, few notes, but rhythmically awkward or oddly voiced.

So the two scales measure genuinely different things: the model measures
**quantity and density**, the labels measure **awkwardness and how long it
takes to learn**. Neither is wrong, and the labels are not simply noise from a
beginner -- though with 93 samples in 3 buckets they are noisy too.

What this exposes is the model's real structural blind spot: **it has no notion
of repetition**. Nothing in the 18 features asks how much of a piece is a
restatement of material already played, which is one of the largest components
of how hard a piece is to learn. A self-similarity feature is cheap to compute
from MusicXML and is the single most promising thing we could add that PianoML
does not have.

Second caveat on this comparison: the catalog is pop, game and film
arrangements, while the model was trained on classical syllabus repertoire, so
part of the weak correlation is repertoire domain shift rather than the model
being wrong.

Two consequences for the plan: the manual `difficulty` field must keep winning
whenever it is set (it encodes something the model cannot see), and our own
catalog is not a validation set for the model -- it is at best a sanity check.

## Step 3 results: the ablation

PSyllabus downloaded (7,901 labelled MIDIs), features extracted for all of
them, same split procedure and same LightGBM hyperparameters as
`piano-syllabus-classifier`. LightGBM only, no MLP -- it carries 75% of their
ensemble weight, and what matters here is the comparison between feature sets.

The reproduction checks out: with all 18 features we get **MAE 0.799, 47.2%
exact, 383 trees**, against their published 0.792 / 47.0% / 383 trees. Same
split, same pipeline.

| Feature set | Test MAE | Exact | Within 1 grade | Domain gap (step 1) |
|---|---|---|---|---|
| all 18 (theirs) | 0.799 | 47.2% | 82.2% | 0.354 |
| minus velocity (15) | 0.800 | 46.7% | 83.2% | 0.317 |
| minus velocity + timing (13) | 0.812 | 46.5% | 81.7% | 0.272 |
| domain-invariant only (10) | 0.865 | 44.9% | 80.0% | 0.110 |

**Dropping the three velocity features is completely free** (MAE 0.800 vs
0.799). That alone removes the need to fabricate velocity at inference, which
was the ugliest part of porting the model as-is.

Dropping `rhythmic_complexity` and `arpeggio_ratio` on top costs 0.013 MAE and
buys a visibly smaller domain gap. Dropping the density block as well costs
0.066 MAE to buy the remaining 0.16 of gap -- the only trade in the table that
is not obviously worth it.

**Decision: the 13-feature set** (all 18 minus the three velocity features,
minus `rhythmic_complexity` and `arpeggio_ratio`), with `note_density` later
swapped for its tempo-free form and the repetition features added -- see the
section below. Roughly 0.81 model error
plus roughly 0.27 of notation/performance noise, against 0.80 plus 0.35 for the
full set -- slightly better end to end, and it never needs a value we cannot
compute from a score.

**Ship LightGBM alone, drop the MLP.** Their full ensemble scores 0.792 against
0.812 for LightGBM alone on 13 features: a 0.02 difference, irrelevant beside a
0.27 domain gap and a 0.79 intrinsic error. In exchange the TypeScript port
loses the safetensors parsing, the frozen BatchNorm and the CORN head, and
becomes a numeric-threshold tree walk and nothing else.

## Tested afterwards: tempo-free density, and repetition

**Tempo.** Everything tempo-dependent was already suspect: a beginner plays
well under the notated tempo without the piece becoming a different piece, and
plenty of real MusicXML carries no tempo marking at all (music21 and any parser
then default to 120, so `note_density` becomes an arbitrary number). Replacing
`note_density` (notes per second) with `notes_per_quarter` (notes per quarter
note) costs 0.007 MAE across five splits -- well inside the seed-to-seed spread
of 0.02. **Go tempo-free**: the accuracy is the same and the feature stops
depending on a field that is often missing or wrong.

Note that `fast_note_ratio` is already tempo-free: it counts notated durations
shorter than an eighth, not real-time speed.

**Repetition.** Three candidate measures were built and tested rather than
assumed:
- `compress_pitch` / `compress_events` -- gzip ratio of the note stream
  (compressed size over raw size), the standard cheap proxy for structure.
- `unique_bar_ratio` -- distinct bars over total bars, bars hashed on rhythm
  plus intervals from the bar's first note, so a figure repeated on a different
  chord counts as the same material.

On PSyllabus the three together are worth about **0.009 MAE**, in the same
direction on all five splits (13 features: 0.815 mean, 13 + repetition: 0.806).
Consistent, and small. Worth keeping since they cost nothing to compute, not
worth calling a breakthrough.

**The hypothesis that repetition explains our own labels did not survive
testing.** Against the 93 hand-labelled catalog scores:

| Measure | Spearman with labels | Spearman with note count |
|---|---|---|
| raw compression ratio | -0.313 | -0.652 |
| compression vs a shuffled control | -0.374 | -0.673 |
| distinct bars (rhythm only) | +0.308 | +0.485 |
| unique bar ratio | -0.151 | -0.391 |
| **plain note count** | **+0.434** | 1.000 |

Every repetition measure is dominated by length: longer pieces genuinely repeat
more, and normalising against a length-matched shuffled control does not break
the coupling. None of them beats simply counting the notes at predicting the
manual labels, and the sign is the opposite of the hypothesis -- more
repetitive reads as *harder*, because more repetitive means longer.

So the story that "Bach BWV 846 is labelled easy because it is one repeated
figure" is a plausible reading of the examples, but it is not what the measures
support. What remains true is the observation itself: nothing available,
including the model, predicts the manual labels better than the raw note count
(0.434 against 0.315), which says more about those labels being a different and
noisy axis than about any single missing feature. 93 samples in three buckets
from one labeller cannot settle it either way.

## Which XML parser

`opensheetmusicdisplay` has no XML dependency at all -- it uses the browser's
`DOMParser`, so reusing it server-side would mean pulling in jsdom.

The syntax half is a solved problem: **`fast-xml-parser`** (zero dependencies,
actively maintained, XML to plain objects). `musicxml-interfaces` exists and
maps MusicXML to typed structures, but it has not been touched since 2022 and
still leaves the hard half undone.

The hard half is not parsing XML, it is **musical semantics**: turning elements
into notes positioned in time (divisions, `backup`/`forward`, `chord`, ties,
staff assignment, repeats). That is roughly 200 lines we write ourselves, and
it is the same logic `ScoreParser.extractExpectedEvents` already implements
against OSMD's object model in the browser.

The alternative is computing the features client-side at upload, where OSMD is
already loaded, and posting them with the file. It saves the parser but gives
up re-deriving grades for scores already in the catalog on a version bump,
which is the main reason to sit in the `scoreMetadata.ts` pattern at all.

## Step 4 results: the port, and what it changed about the feature set

Written and validated. `server/grade/` holds it: `musicXmlNotes.ts` (notes out
of MusicXML), `gradeFeatures.ts` (the features), `lightgbm.ts` (the tree walk),
`gradeModel.json` (the trained model, 125 trees, 104 KB), `index.ts`
(`estimateScoreGrade`, mirroring `extractScoreMetadata`: best-effort, never
throws). No new runtime dependency. Grading the whole 99-score catalog takes
278 ms.

**The port forced one more cut to the feature set.** Comparing the TypeScript
features (from `xml_score.musicxml`) against the Python reference (from the
same piece's `midi_score.mid`) on 60 ASAP pieces showed three features
disagreeing badly while everything else matched:

- `fast_note_ratio`: 0.018 from the score against 0.193 from the rendering, a
  factor of ten. The cause is trivial and unfixable: **a MIDI renderer writes
  every note one tick short** (0.9979 of a quarter, not 1.0), so every eighth
  note lands just under a "shorter than an eighth" threshold that the notated
  value sits exactly on.
- `avg_polyphony` and `polyphony_entropy`: about 24% apart, same cause. Those
  one-tick gaps each become their own sample in the event sweep, dragging the
  average down.

Held duration is a rendering convention, not a fact of the score. So the final
set is **nine features, none of which depends on how long a note is held**:
`max_polyphony`, `pitch_range`, `num_distinct_pitches`, `chord_ratio`,
`wide_leap_ratio`, `repeated_note_ratio`, `low_ratio`, `high_ratio`,
`hand_independence`. Retrained: **MAE 0.816, 45.9% exact, 81.8% within one
grade** -- indistinguishable from the 18-feature original (0.810 over five
splits) and from every other set tried (all between 0.86 and 0.88 once the
domain gap is added in).

After the cut, TypeScript and Python agree to **under 1% on every feature**,
and exactly on four of them.

**Repeats had to be unfolded after all.** The first version deliberately did
not, on the reasoning that ratios are invariant to playing a section twice.
That is wrong for two of the nine: `repeated_note_ratio` is
`(notes - distinct) / (notes - 1)` and `wide_leap_ratio` divides by the note
count, so both move when the count doubles and the pitch set does not. Measured
on the catalog: leaving repeats folded shifted the grade by **1.09 on average**
for the 37 scores that have them, always downwards -- more than the model's own
error. `playbackOrder` now expands repeat barlines and first/second endings
(jump directions are not followed: rare here, ambiguous, and capped expansion
matters more than completeness). Median note count against music21 went from
0.99 with big outliers to exactly 1.000.

**Final agreement with the Python pipeline, per score: 0.094 of a grade on
average** (max 0.93) across the catalog.

The exception is worth recording because it is music21's artifact, not ours:
**ten scores carry `<harmony>` chord symbols, which music21 renders as extra
sounding notes** (656 notes in the MIDI against 438 real ones in the XML for
"Perfect"). Those score 1.75 apart on average. Our parser ignores chord symbols,
which is the correct behaviour and also matches the training data, where
transcribed performances contain no such phantom notes.

## The length problem

The grade is, to a first approximation, a note counter. On the catalog,
**Spearman(grade, note count) = +0.90**. A short hard piece ranks last: the
catalog's "Moanin" head is 66 notes of jazz and comes out at 1.00.

Three measurements frame it:

- **The labels have the bias too.** On PSyllabus, Spearman(syllabus grade, note
  count) = +0.79, and on our own catalog Spearman(manual tag, note count) =
  +0.43. In graded repertoire, long really does mean hard. The model did not
  invent this.
- **The model amplifies it**: its predictions correlate +0.92 with length,
  higher than the labels do. Our features are length proxies --
  `repeated_note_ratio` correlates +0.93 with the note count and
  `num_distinct_pitches` +0.81, since both saturate as a piece gets longer.
- **But length alone is not enough**: a model given only the note count scores
  MAE 0.992, against 0.843 for the nine features. They carry roughly 0.15 of a
  grade of real information beyond size.

### Two ways to remove it, both measured

**Local features.** The same nine measurements computed over a sliding window
of 64 consecutive notes and aggregated at the 75th percentile -- "how hard does
it get" rather than "how much of it is there". A window counted in notes is
also the only window definition that means the same thing on a score and on a
performance. Result: correlation with length falls from +0.91 to +0.16, and
Moanin rises from 1.8 to 6.4. But PSyllabus MAE degrades from 0.843 to 1.264.

**Holding length constant** (the cleaner method). Give the model the note count
as an explicit feature during training, so the trees attribute the length
effect to it, then pin that input to the training median when predicting. What
is left answers "how hard would this be at ordinary length". Correlation with
length falls from +0.93 to +0.13, and Moanin rises from 1.4 to 5.1.

### Why neither is shipped as *the* grade

Holding length constant collapses the answer. On the PSyllabus test set, where
the true grades are known:

| | spread (sd) | MAE | separation of grade 1-3 from 7-8 |
|---|---|---|---|
| true labels | 2.43 | - | - |
| grade, length known | 2.22 | 0.822 | 3.99 |
| grade, length held | 1.28 | 1.359 | 2.73 |

Almost every piece lands between 3.3 and 5.0. That is the honest reading:
length was carrying most of the signal the nine features had, so removing it
leaves a flatter and noisier ranking rather than a better one. It fixes Moanin
and breaks the ordering everywhere else.

The deeper reason is that nothing in the feature set can see what actually
makes Moanin hard -- jazz harmony, syncopation, blue-note voicings, the
independence of the two hands as *lines* rather than as registers. Removing
length does not add that signal; it only removes the one signal we had.

### What to do instead

**Show the length next to the grade** (measures, or note count) rather than
trying to hide it inside a single number. A catalog row reading "Grade 5, 54
bars" and one reading "Grade 5, 210 bars" say different things, and the reader
can tell them apart instantly. This costs nothing, hides nothing, and does not
degrade the calibrated number.

The length-controlled prediction is kept as a measured experiment, not a
shipped field. Making a real "peak demand" number work needs features that
capture harmonic and rhythmic difficulty -- the MusicXML-native signals in the
next section -- and those cannot be trained on PSyllabus at all, since it
contains no scores.

## Plan

**Step 1 -- measure the domain gap. DONE**, see the section above. PSyllabus
is usable if we pick domain-invariant features.

**Step 2 -- request CIPI, in parallel.** Free, no commitment, and it is the
only path to a model that actually sees key signature, real hands and chord
spans. Worth sending whatever step 1 concludes.

**Step 3 -- train our own weights on PSyllabus. DONE**, see the ablation
above: 13 features, LightGBM only. Cheap, as expected: LightGBM on 7,900 x 18 trains in seconds on CPU, the MLP in minutes. No
GPU. Training our own also settles three things at once: it removes the
licensing grey area, it lets us drop the three velocity features outright
instead of faking them at inference, and it lets us fix the two sorted-pitch
bugs instead of reproducing them. Baseline to beat: MAE 0.79.

**Step 4 -- port inference to TypeScript, server-side only. DONE**, see above. No new runtime dependency, no Python on the VPS, and no browser
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
hand, chord span in semitones, and above all **repetition / self-similarity**,
which the catalog comparison above singles out as the biggest missing signal. Displayed as an explanation of the grade rather
than folded into it, because mixing a calibrated number with invented weights
loses the calibration. Folding them in properly means retraining on CIPI.
