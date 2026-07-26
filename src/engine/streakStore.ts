const STORAGE_KEY = 'piano-trainer:practice-days'

export interface StreakStats {
  currentStreak: number
  longestStreak: number
  totalDaysPracticed: number
}

// Local calendar day (not UTC) -- a streak is about the player's own day
// boundary, not the server's/browser's UTC offset.
function localDayString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, delta: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + delta)
  return result
}

// Date.UTC of a day string is timezone-independent and DST-independent, so
// subtracting two of these always yields an exact whole-day count -- unlike
// subtracting real (local, DST-affected) Date instants.
function dayNumber(dayString: string): number {
  const [year, month, day] = dayString.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000)
}

function readPracticeDays(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function writePracticeDays(days: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(days)))
  } catch {
    // Storage unavailable (private browsing, quota) -- streak just won't persist.
  }
}

/** Marks `now`'s local calendar day as practiced. Safe to call multiple times
 * per day (a Set, not a counter) -- call at the start of a practice session,
 * not only on completion, so quitting early still counts as a practice day. */
export function recordPracticeDay(now: Date = new Date()): void {
  const days = readPracticeDays()
  days.add(localDayString(now))
  writePracticeDays(days)
}

/** Longest run of calendar-consecutive practice days, current streak (alive
 * if the last practiced day is today or yesterday -- a streak survives until
 * a full day is missed, matching the Duolingo-style convention), and total
 * distinct days practiced ever. */
export function getStreakStats(now: Date = new Date()): StreakStats {
  const days = readPracticeDays()
  const totalDaysPracticed = days.size
  if (totalDaysPracticed === 0) {
    return { currentStreak: 0, longestStreak: 0, totalDaysPracticed: 0 }
  }

  const sortedDays = Array.from(days).sort()

  let longestStreak = 1
  let run = 1
  for (let i = 1; i < sortedDays.length; i += 1) {
    run = dayNumber(sortedDays[i]) - dayNumber(sortedDays[i - 1]) === 1 ? run + 1 : 1
    longestStreak = Math.max(longestStreak, run)
  }

  const lastDay = sortedDays[sortedDays.length - 1]
  const isStreakAlive = lastDay === localDayString(now) || lastDay === localDayString(addDays(now, -1))

  let currentStreak = 0
  if (isStreakAlive) {
    currentStreak = 1
    for (let i = sortedDays.length - 1; i > 0; i -= 1) {
      if (dayNumber(sortedDays[i]) - dayNumber(sortedDays[i - 1]) === 1) {
        currentStreak += 1
      } else {
        break
      }
    }
  }

  return { currentStreak, longestStreak, totalDaysPracticed }
}
