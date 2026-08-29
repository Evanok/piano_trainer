/**
 * The few shared visual decisions, in one place because they now repeat across
 * every non-practice screen (Home, ScoreLibrary, ExerciseSetup, Stats, End).
 *
 * The practice screen deliberately opts out of all of this: a score needs a
 * calm, near-white background to read notes against, and its own colored strip
 * (ScoreHud) is the only accent it should carry.
 */

/** Pastel page wash. Put it on a full-width wrapper, not on the content column. */
export const PAGE_BACKGROUND = 'bg-gradient-to-br from-indigo-50 via-white to-amber-50'

/** A panel sitting on that wash -- slightly translucent so the tint shows through. */
export const PAGE_CARD = 'rounded-xl border border-indigo-100 bg-white/80 shadow-sm'

/** The primary action on a page (one per screen: start, save, confirm). */
export const PRIMARY_BUTTON =
  'rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60'

/** Everything else next to it. */
export const SECONDARY_BUTTON =
  'rounded-md border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-60'

/**
 * One pastel family per kind of number, reused wherever that number shows up so
 * a stat keeps its color across screens (a streak is orange on Home, in the
 * catalog header, on the End screen and in Stats).
 */
export const STAT_TONES = {
  neutral: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  time: 'border-sky-200 bg-sky-50 text-sky-700',
  streak: 'border-orange-200 bg-orange-50 text-orange-700',
  days: 'border-purple-200 bg-purple-50 text-purple-700',
  grade: 'border-amber-200 bg-amber-50 text-amber-700',
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  bad: 'border-rose-200 bg-rose-50 text-rose-700',
} as const

export type StatTone = keyof typeof STAT_TONES

/**
 * One colour per kind of practice, shared by every place the split appears (the
 * "where the time goes" rows and the per-day chart), so a colour means the same
 * activity wherever it is seen. Scores keep the indigo the chart has always
 * been, so a day of nothing but scores looks exactly as it did before the split
 * existed.
 */
export const ACTIVITY_ORDER = ['score', 'exercise', 'reading'] as const

export type ActivityToneKey = (typeof ACTIVITY_ORDER)[number]

export const ACTIVITY_TONES: Record<ActivityToneKey, string> = {
  score: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  exercise: 'border-rose-200 bg-rose-50 text-rose-700',
  reading: 'border-purple-200 bg-purple-50 text-purple-700',
}

/** The solid fill of the same colour, for a bar rather than a pill. */
export const ACTIVITY_BARS: Record<ActivityToneKey, string> = {
  score: 'bg-indigo-400',
  exercise: 'bg-rose-400',
  reading: 'bg-purple-400',
}
