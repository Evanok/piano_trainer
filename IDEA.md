# IDEA.md

The one idea still open.

Dropped or done, never to be re-proposed: the position scrubber (done as
`LoopRangeBar`), an automatic difficulty grade (rejected -- difficulty stays
user-assigned), MIDI file import (rejected -- MusicXML only), the note-naming and
note-to-key quizzes (done as the reading quiz's two answer modes), the
sight-reading drills at the keyboard, the keyboard-free quizzes, and the daily
challenge and progression ladder built on top of them.

## 1. Harvest MusicXML for our own catalog

Clean beginner MusicXML is the scarce resource for this app, and
[PianoML](https://github.com/piano-ml/piano-ml) carries a large graded library of
it (sightread's own collection is MIDI, so it is out). Check the licence per file,
then seed `data/scores/` with a one-off offline script rather than an in-app
importer.
