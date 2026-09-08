/**
 * The lesson that goes with the chord drill: what to know before a round, and
 * what to have learnt by the end of it.
 *
 * It sits next to the drill rather than on a screen of its own, because it is
 * only ever read either just before a round or just after a bad one. Open by
 * default: the first thing this drill needs is the table it is asking about,
 * and a player who already knows it collapses the panel once.
 *
 * One section per rung of the ladder (see IDEA.md), and only the first rung
 * exists so far. Its content is deliberately not the seven facts but the three
 * groups they fall into -- "do fa sol are major, re mi la are minor, si is
 * diminished" is one thing to remember instead of seven, and it is the same
 * grouping the generator's own table is written out in.
 */
import { useState } from 'react'
import { chordQualityLabel, diatonicTriadOf, triadAt, chordRoots } from '../engine/chordQuiz'
import { latinNameOf } from '../engine/readingQuiz'
import { PAGE_CARD } from '../theme'
import type { ChordQuality } from '../types/chord'

/** The seven chords, in scale order, built once from the generator's own table. */
const ROWS = chordRoots('treble').map((root) => {
  const notes = triadAt(root)
  const triad = diatonicTriadOf(notes[0].step)
  return {
    step: notes[0].step,
    name: latinNameOf(notes[0].step),
    spelling: notes.map((note) => latinNameOf(note.step)).join(' '),
    quality: triad.quality,
    degree: triad.degree,
  }
})

const QUALITY_TONES: Record<ChordQuality, string> = {
  major: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  minor: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  diminished: 'border-amber-200 bg-amber-50 text-amber-700',
  augmented: 'border-rose-200 bg-rose-50 text-rose-700',
}

function groupOf(quality: ChordQuality): string {
  return ROWS.filter((row) => row.quality === quality)
    .map((row) => row.name)
    .join(' ')
}

export function ChordLesson() {
  const [open, setOpen] = useState(true)

  return (
    <section className={`flex w-full flex-col gap-3 p-5 ${PAGE_CARD}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex items-baseline justify-between gap-4 text-left"
      >
        <h2 className="text-lg font-medium text-gray-900">The seven chords of do major</h2>
        <span className="text-xs font-medium text-indigo-600">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-gray-900">1. What you are looking at</h3>
            <p className="text-xs leading-5 text-gray-600">
              Three notes stacked on three consecutive staff positions: all on lines, or all in
              spaces, never mixed. That is a triad in root position, and the bottom note is the one
              that names it -- a stack starting on re is a re chord, whatever the two notes above it
              are.
            </p>
            <p className="text-xs leading-5 text-gray-600">
              Here is the catch worth knowing early: with no sharps or flats, every one of these
              stacks is the same drawing. You cannot tell major from minor by looking at the shape,
              because there is no shape to tell apart. You tell them apart by reading{' '}
              <em>which</em> note is at the bottom, and knowing what that note's chord is in this
              key. That is the whole drill, and it is the table below.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-gray-900">2. Three groups, not seven facts</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              {(['major', 'minor', 'diminished'] as const).map((quality) => (
                <div
                  key={quality}
                  className={`flex flex-col gap-1 rounded-lg border px-3 py-2 ${QUALITY_TONES[quality]}`}
                >
                  <span className="text-xs font-semibold uppercase tracking-wide">
                    {chordQualityLabel(quality)}
                  </span>
                  <span className="text-lg font-bold">{groupOf(quality)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs leading-5 text-gray-600">
              Three major, three minor, one lonely diminished. Learn it in that shape and the seven
              rows below stop being seven things to remember.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-gray-900">3. The table</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[22rem] text-left text-xs">
                <thead className="text-gray-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Chord</th>
                    <th className="py-1 pr-3 font-medium">Notes</th>
                    <th className="py-1 pr-3 font-medium">Quality</th>
                    <th className="py-1 font-medium">Degree</th>
                  </tr>
                </thead>
                <tbody className="text-gray-800">
                  {ROWS.map((row) => (
                    <tr key={row.step} className="border-t border-gray-100">
                      <td className="py-1.5 pr-3 font-semibold">{row.name}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{row.spelling}</td>
                      <td className="py-1.5 pr-3">{chordQualityLabel(row.quality)}</td>
                      <td className="py-1.5 font-medium text-gray-500">{row.degree}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs leading-5 text-gray-600">
              The degree is the chord's number in the key, written large for a major chord and small
              for a minor one. It is not asked for here, but it is what the same chords will be
              called everywhere else, and the drill shows it after each answer.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-gray-900">4. Why, in one paragraph</h3>
            <p className="text-xs leading-5 text-gray-600">
              A triad is two stacked thirds, and a third is either four semitones (major) or three
              (minor). Major means the wide one at the bottom, minor the narrow one; diminished is
              both narrow. On white keys only, what decides it is where the scale's two natural
              half-steps -- mi to fa, and si to do -- happen to land inside the stack. You do not
              need this to answer a question, but it is why the table is not arbitrary.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-gray-900">5. How to work it</h3>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-xs leading-5 text-gray-600">
              <li>Read the bottom note first, always. Name it out loud if that helps.</li>
              <li>
                Then recall its group, not the whole table: is that note one of the three majors,
                one of the three minors, or si?
              </li>
              <li>
                Aim to stop counting. At the start you will count lines to find the bottom note;
                the drill is doing its job when you stop.
              </li>
              <li>
                Do a round in the bass clef too once the treble one is comfortable. Same seven
                chords, and the left hand is where you will actually read them.
              </li>
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  )
}
