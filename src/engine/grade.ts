export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F'

const THRESHOLDS: Array<[number, Grade]> = [
  [100, 'S'],
  [90, 'A'],
  [75, 'B'],
  [60, 'C'],
  [40, 'D'],
]

/** Maps first-try accuracy (successPercent) to a letter grade -- S requires a
 * flawless run (zero errors before completion), everything below 40% is F. */
export function computeGrade(successPercent: number): Grade {
  for (const [minPercent, grade] of THRESHOLDS) {
    if (successPercent >= minPercent) {
      return grade
    }
  }
  return 'F'
}
