/**
 * The lesson that goes with the chord drill: what to know before a round, and
 * what to have learnt by the end of it.
 *
 * It sits next to the drill rather than on a screen of its own, because it is
 * only ever read either just before a round or just after a bad one. Open by
 * default: a player who already knows this collapses it once.
 *
 * **It teaches a method, not a table, and that ordering was earned the hard
 * way.** An earlier version led with the seven chords of do major grouped as
 * "do fa sol major, re mi la minor, si diminished" -- which reads as a law of
 * nature and is nothing of the sort: it holds only because that material has no
 * accidental, and it collapses the moment one appears. A player told to learn
 * it concluded, rightly, that it was rote nonsense. So the order here is: what
 * a chord's name is made of, how to measure the quality (which works in every
 * key, forever), how to do that counting on white keys, how to find the root
 * when the stack is inverted, and only then the table -- presented as what the
 * method produces rather than as something to memorise.
 *
 * **Two corrections found by a player getting a chord wrong, both worth not
 * undoing.** The quality was described as "the gap between the two bottom
 * notes", which is only true in root position: on sol - do - mi the two bottom
 * notes are the wide gap and say nothing, and the lesson was committing
 * exactly the sin it warns about -- stating as a rule something that holds only
 * under a restriction. It now says the root and the note two letters above it.
 * And nothing said out loud that **the staff cannot show the quality at all**
 * (a major third and a minor third are the same drawing), while section 4 does
 * teach judging narrow-versus-wide by eye to find the root -- so the reasonable
 * conclusion was that a narrow-looking gap means minor. That is now the first
 * thing section 2 says, and section 4 says what its own eyeballing is for.
 */
import { useState } from 'react'
import { ChordDiagram } from './ChordDiagram'
import { chordQualityLabel, chordQualitySemitones, diatonicTriadOf, triadAt, chordRoots } from '../engine/chordQuiz'
import { latinNameOf } from '../engine/readingQuiz'
import { PAGE_CARD } from '../theme'
import type { ChordQuality } from '../types/chord'

/** The seven chords of do major, built from the generator's own table so the
 * lesson can never drift from what the drill actually asks. */
const ROWS = chordRoots('treble').map((root) => {
  const notes = triadAt(root)
  const triad = diatonicTriadOf(notes[0].step)
  return {
    step: notes[0].step,
    name: latinNameOf(notes[0].step),
    spelling: notes.map((note) => latinNameOf(note.step)).join(' '),
    bottomGap: notes[1].midi - notes[0].midi,
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

const QUALITY_ROWS: Array<{ quality: ChordQuality; example: string }> = [
  { quality: 'major', example: 'do mi sol' },
  { quality: 'minor', example: 'do mi♭ sol' },
  { quality: 'diminished', example: 'do mi♭ sol♭' },
  { quality: 'augmented', example: 'do mi sol♯' },
]

/** One octave of keys, do to do, with the two seams where white keys touch. */
const WHITE_NAMES = ['do', 're', 'mi', 'fa', 'sol', 'la', 'si', 'do']
/** Index of the white key a black key sits AFTER. The two missing ones (2 and
 * 6) are the whole point of the drawing: mi–fa and si–do have none. */
const BLACK_AFTER = [0, 1, 3, 4, 5]
const WHITE_W = 24
const WHITE_H = 68
const PAD = 4

/**
 * A keyboard for a player who does not have one.
 *
 * The method in section 3 rests on a fact about the instrument -- mi–fa and
 * si–do are the only two places where two white keys touch -- and the drill is
 * deliberately playable on a phone with no piano in reach, which is exactly
 * where that fact is hardest to check. So the one octave it concerns is drawn
 * here, with the two seams marked, and then it can be forgotten.
 *
 * Hand-drawn for the same reason `ChordDiagram` is: it is a diagram, not an
 * instrument. `VirtualKeyboard` is 88 keys that scroll, follow the notes and
 * carry the app's state colours -- none of which belongs in a static picture of
 * a rule.
 */
function HalfStepKeyboard() {
  const width = PAD * 2 + WHITE_NAMES.length * WHITE_W
  const seamX = (index: number) => PAD + (index + 1) * WHITE_W
  return (
    <svg
      viewBox={`0 -16 ${width} ${WHITE_H + 42}`}
      className="w-full max-w-[22rem] self-center"
      role="img"
      aria-label="One octave of a piano keyboard, with the mi-fa and si-do seams marked"
    >
      {WHITE_NAMES.map((name, index) => (
        <rect
          key={`${name}-${index}`}
          x={PAD + index * WHITE_W}
          y={0}
          width={WHITE_W - 1}
          height={WHITE_H}
          rx={2}
          fill="#ffffff"
          stroke="#cbd5e1"
        />
      ))}
      {BLACK_AFTER.map((index) => (
        <rect
          key={index}
          x={seamX(index) - 8}
          y={0}
          width={15}
          height={42}
          rx={2}
          fill="#334155"
        />
      ))}
      {/* The two seams with no black key over them, which is the whole fact. */}
      {[2, 6].map((index) => (
        <g key={index}>
          <line
            x1={seamX(index)}
            y1={0}
            x2={seamX(index)}
            y2={WHITE_H}
            stroke="#f59e0b"
            strokeWidth={3}
          />
          <text
            x={seamX(index)}
            y={-5}
            textAnchor="middle"
            fontSize={9}
            fontWeight={600}
            fill="#b45309"
          >
            {index === 2 ? 'mi–fa' : 'si–do'}
          </text>
        </g>
      ))}
      {WHITE_NAMES.map((name, index) => (
        <text
          key={`${name}-${index}-label`}
          x={PAD + index * WHITE_W + (WHITE_W - 1) / 2}
          y={WHITE_H + 14}
          textAnchor="middle"
          fontSize={9}
          fill="#475569"
        >
          {name}
        </text>
      ))}
    </svg>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {children}
    </div>
  )
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
        <h2 className="text-lg font-medium text-gray-900">How to read a chord</h2>
        <span className="text-xs font-medium text-indigo-600">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open ? (
        <div className="flex flex-col gap-5">
          <Section title="1. A chord's name is two things">
            <p className="text-xs leading-5 text-gray-600">
              A <strong>root</strong> (the letter) and a <strong>quality</strong> (major, minor,
              diminished, augmented). They are independent: sol major and sol minor both exist, they
              are two different chords built on the same note. Reading a chord means finding both,
              and they are found separately -- neither one tells you the other.
            </p>
            <p className="text-xs leading-5 text-gray-600">
              The three notes themselves are always the same shape: a letter, the letter two above,
              and the letter four above. Do (skip re) mi (skip fa) sol. That never changes; only the
              sharps and flats on those letters do, and that is exactly what the quality is.
            </p>
          </Section>

          <Section title="2. The quality: measure the root and its third">
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-900">
              First, the thing the staff will never tell you: <strong>the drawing does not show the
              quality</strong>. do→mi (major) and re→fa (minor) are the exact same picture -- two
              positions apart, noteheads touching. The difference between them is one key on a
              piano and nothing at all on paper. So a gap that <em>looks</em> narrow tells you it is
              a third rather than a fourth, which is about the inversion; it never tells you major
              or minor.
            </p>
            <p className="text-xs leading-5 text-gray-600">
              What is measured is the <strong>root and the note two letters above it</strong>: do→mi
              for a do chord, re→fa for a re chord. In root position those happen to be the two
              bottom notes, which is why it is usually put that way -- but once the stack is
              inverted they are not. On sol – do – mi the two bottom notes are sol and do, which is
              the wide gap, and it says nothing about the quality: the root is do (section 4), so
              the pair to read is do→mi.
            </p>
            <p className="text-xs leading-5 text-gray-600">
              Count the semitones between that pair -- a semitone is one key to the next, black keys
              included.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[20rem] text-left text-xs">
                <thead className="text-gray-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Bottom gap</th>
                    <th className="py-1 pr-3 font-medium">Top gap</th>
                    <th className="py-1 pr-3 font-medium">Quality</th>
                    <th className="py-1 font-medium">Example</th>
                  </tr>
                </thead>
                <tbody className="text-gray-800">
                  {QUALITY_ROWS.map(({ quality, example }) => {
                    const [bottom, top] = chordQualitySemitones(quality)
                    return (
                      <tr key={quality} className="border-t border-gray-100">
                        <td className="py-1.5 pr-3 font-semibold tabular-nums">{bottom}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{top}</td>
                        <td className="py-1.5 pr-3">
                          <span className={`rounded border px-1.5 py-0.5 ${QUALITY_TONES[quality]}`}>
                            {chordQualityLabel(quality)}
                          </span>
                        </td>
                        <td className="py-1.5 tabular-nums">{example}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs leading-5 text-gray-600">
              In practice you only ever ask one question: <strong>4 means major, 3 means minor</strong>
              . The top gap only separates diminished from minor and augmented from major, and those
              two are rare. This works in every key, with or without sharps, forever -- it is the
              only thing here worth calling a method.
            </p>
          </Section>

          <Section title="3. Counting it without a piano in front of you">
            <p className="text-xs leading-5 text-gray-600">
              Counting four keys off a page, with no keyboard in reach, is miserable -- and it is
              not what this asks for. <strong>You never count anything.</strong> You ask one
              yes/no question about three letters, which works on a bus. It comes from{' '}
              <strong>one single fact</strong>:
            </p>
            <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-900">
              There are only <strong>two</strong> places where two white keys touch with no black key
              between them: <strong>mi–fa</strong> and <strong>si–do</strong>. Everywhere else there
              is a black key in between.
            </p>
            <HalfStepKeyboard />
            <p className="text-xs leading-5 text-gray-600">
              That picture is here so you never need the real thing: the two amber seams are the
              only two places on the whole instrument where it happens, and once that is in, the
              keyboard can go.
            </p>
            <p className="text-xs leading-5 text-gray-600">
              So take the root and its third, say the three letters they span, and ask:{' '}
              <strong>is mi–fa or si–do one of the two pairs inside them?</strong> If yes, the gap
              is one semitone shorter -- 3, minor. If no, it is 4, major. Three letters, one
              question, no counting.
            </p>
            <p className="text-xs leading-5 text-gray-600">
              Check it: the chord on <strong>do</strong> is do–mi, so the letters are do-re-mi and
              the pairs inside are do-re and re-mi -- neither is one of the two, so 4, major. The
              chord on <strong>re</strong> is re–fa, and re-<em>mi–fa</em> is in there,
              so 3, minor. The chord on <strong>fa</strong> is fa–la, fa-sol-la, neither pair, so 4,
              major. The chord on <strong>si</strong> is si–re, and <em>si–do</em>-re is in there, so
              3; and its top is re–fa, which catches <em>mi–fa</em>, so 3 as well -- both small, which
              is diminished. That is why si is the only diminished one: it is the only chord that
              catches both natural half-steps.
            </p>
            <p className="text-xs leading-5 text-gray-600">
              With accidentals turned on, a sharp or a flat written in front of a note simply moves
              the count by one. Nothing about the method changes.
            </p>
          </Section>

          <Section title="4. The root: follow the gap">
            <p className="text-xs leading-5 text-gray-600">
              Take do – mi – sol and keep going to the do above. You get{' '}
              <strong>three steps</strong>: do→mi is a third (skip re), mi→sol is a third (skip fa),
              and sol→do is a <strong>fourth</strong> (skip la and si). Two thirds and a fourth --
              that is true of every three-note chord, and the fourth is always the step that goes
              from the fifth back up to the root.
            </p>
            <p className="text-xs leading-5 text-gray-600">
              An <strong>inversion</strong> changes nothing about that ring. It only decides which
              note you start on, so it decides where the fourth lands in what gets drawn:
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              <ChordDiagram
                title="Start on the root"
                notes={[
                  { position: -2, name: 'do', isRoot: true },
                  { position: 0, name: 'mi' },
                  { position: 2, name: 'sol' },
                ]}
                caption="Two thirds. The fourth falls off the top and is not drawn, so there is no gap: the root is the bottom note."
              />
              <ChordDiagram
                title="Start on the third"
                notes={[
                  { position: 0, name: 'mi' },
                  { position: 2, name: 'sol' },
                  { position: 5, name: 'do', isRoot: true },
                ]}
                gapBelow={1}
                caption="The fourth landed at the top, so the gap is at the top: the root is the top note."
              />
              <ChordDiagram
                title="Start on the fifth"
                notes={[
                  { position: 2, name: 'sol' },
                  { position: 5, name: 'do', isRoot: true },
                  { position: 7, name: 'mi' },
                ]}
                gapBelow={0}
                caption="The fourth landed at the bottom, so the gap is at the bottom: the root is the middle note."
              />
            </div>

            <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-900">
              One rule, not three: <strong>the gap is always the step from the fifth up to the
              root</strong>, so <strong>the note immediately above the gap is the root</strong>. No
              gap at all means the fourth fell outside the drawing, so you started on the root: it is
              the bottom note.
            </p>

            <p className="text-xs leading-5 text-gray-600">
              And you can see which is which without counting anything -- this is about{' '}
              <strong>third versus fourth</strong>, which is what finds the root. It says nothing
              about major versus minor: see the red box in section 2.
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-xs leading-5 text-gray-600">
              <li>
                <strong>A third</strong> (narrow): both notes on <strong>lines</strong>, or both in{' '}
                <strong>spaces</strong>. Their heads touch -- that is the figure-eight look.
              </li>
              <li>
                <strong>A fourth</strong> (the gap): one note on a <strong>line</strong>, the other in
                a <strong>space</strong>. There is visible daylight between them.
              </li>
            </ul>
          </Section>

          <Section title="5. A full example">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-start">
              <ChordDiagram
                title="What is this chord?"
                notes={[
                  { position: 3, name: 'la' },
                  { position: 6, name: 're', isRoot: true },
                  { position: 8, name: 'fa', accidental: '♯' },
                ]}
                gapBelow={0}
                caption="Bottom note in a space, middle note on a line: that is the fourth. The top two are both on lines: a third."
              />
              <ol className="flex list-decimal flex-col gap-1.5 pl-4 text-xs leading-5 text-gray-600">
                <li>
                  <strong>The gap is at the bottom</strong> → the root is the middle note.
                </li>
                <li>
                  Read it: it is on the fourth line, <strong>re</strong>. So this is a re chord, and
                  one note was enough to know it.
                </li>
                <li>
                  Rebuild it in order: a re chord is re – fa – la. The ♯ is written on the top note,
                  which is the <em>fa</em> -- an accidental travels with its note, not with the place
                  it happens to be drawn. So the chord is <strong>re – fa♯ – la</strong>.
                </li>
                <li>
                  Measure the bottom gap: re→fa alone is 3 semitones (mi–fa is inside it), and the ♯
                  adds one, so <strong>4 → major</strong>.
                </li>
                <li>
                  Answer: <strong>re major, second inversion</strong>. Without that single ♯ the same
                  three positions would read re minor -- which is exactly why a round with no
                  accidentals cannot teach you to measure anything.
                </li>
              </ol>
            </div>
          </Section>

          <Section title="6. The seven chords of do major">
            <p className="text-xs leading-5 text-gray-600">
              This is what the method produces when no accidental is allowed. It is{' '}
              <strong>not</strong> a rule to learn: it only holds inside do major, and it says
              nothing about sol minor, which exists perfectly well elsewhere. Read it as a check on
              your counting. It will end up memorised on its own, from use, which is the only kind of
              memorisation worth anything here.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[24rem] text-left text-xs">
                <thead className="text-gray-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Chord</th>
                    <th className="py-1 pr-3 font-medium">Notes</th>
                    <th className="py-1 pr-3 font-medium">Bottom gap</th>
                    <th className="py-1 pr-3 font-medium">Quality</th>
                    <th className="py-1 font-medium">Degree</th>
                  </tr>
                </thead>
                <tbody className="text-gray-800">
                  {ROWS.map((row) => (
                    <tr key={row.step} className="border-t border-gray-100">
                      <td className="py-1.5 pr-3 font-semibold">{row.name}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{row.spelling}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{row.bottomGap}</td>
                      <td className="py-1.5 pr-3">{chordQualityLabel(row.quality)}</td>
                      <td className="py-1.5 font-medium text-gray-500">{row.degree}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs leading-5 text-gray-600">
              The degree is the chord's number <em>within this key</em> -- large for major, small for
              minor. It is never asked for, and a chord with an accidental has none, since it does
              not belong to do major at all.
            </p>
          </Section>

          <Section title="7. How to work it">
            <ul className="flex list-disc flex-col gap-1 pl-4 text-xs leading-5 text-gray-600">
              <li>
                Turn <strong>accidentals on</strong> as soon as you can. With them off, each letter
                has one possible chord, so the quality can be guessed from the letter and you are not
                training the method at all.
              </li>
              <li>
                <strong>Quality only</strong> is the mode that drills section 2 and 3: one tap, and
                nothing to do but look at the bottom two notes.
              </li>
              <li>
                <strong>Which chord</strong> plus <strong>inversions</strong> drills section 4: find
                the gap, then the root.
              </li>
              <li>
                After each answer the keyboard below shows the three keys. That is the last step --
                it needs no new knowledge once the chord is named, only the habit of seeing where it
                falls under the hand.
              </li>
            </ul>
          </Section>
        </div>
      ) : null}
    </section>
  )
}
