/// <reference lib="dom" />
/**
 * Practice-screen switch benchmark: drives the real app in Chromium, opens one
 * score from the catalog, and times every practice-mode and hand-mode switch.
 *
 * Not a vitest test, on purpose. What freezes is OSMD laying out and drawing a
 * real score (render(), updateGraphic(), the cursor walk, the SVG recoloring),
 * and none of that can be measured without a real layout engine: jsdom has
 * none, so its timings would describe nothing the player sees.
 *
 * The score is read from the local catalog, never from the repository: the
 * reference piece is a copyrighted arrangement and this repository is public.
 * The script therefore needs a running app whose data directory holds it.
 *
 *   npm run dev                      # in another terminal
 *   npm run bench:practice           # desktop, x64 speed
 *   BENCH_CPU_THROTTLE=4 BENCH_VIEWPORT=mobile npm run bench:practice
 *   BENCH_PROFILE=1 npm run bench:practice   # plus the hottest functions per switch
 *
 * Environment:
 *   BENCH_URL           app address (default http://localhost:5173)
 *   BENCH_SCORE         catalog search that finds the piece (default: the reference piece)
 *   BENCH_RUNS          passes over the whole switch sequence (default 3, the median is reported)
 *   BENCH_VIEWPORT      desktop | mobile (landscape phone, touch, the mobile layout)
 *   BENCH_CPU_THROTTLE  Chromium CPU slowdown factor, a rough phone stand-in (default 1)
 *   BENCH_CDP           connect to an existing Chromium over CDP instead of launching one,
 *                       e.g. a real Android phone (see the README note at the bottom)
 *   BENCH_PASSWORD      API password, when the server has one
 *   BENCH_PROFILE       1 to sample a CPU profile of every switch
 *   BENCH_OUT           JSON file to write the results to
 *
 * Measuring a real phone: enable USB debugging, open Chrome on the phone, then
 *   adb forward tcp:9222 localabstract:chrome_devtools_remote
 *   BENCH_CDP=http://localhost:9222 BENCH_URL=http://<this machine's LAN ip>:5173 npm run bench:practice
 * (the dev server has to listen on the LAN for that: `npx vite --host`).
 */
import { writeFileSync } from 'node:fs'
import { chromium, type Browser, type CDPSession, type Page } from 'playwright-core'

const BASE_URL = process.env.BENCH_URL ?? 'http://localhost:5173'
const SCORE_QUERY = process.env.BENCH_SCORE ?? 'The Days When My Mother Was There'
const RUNS = Math.max(1, Number(process.env.BENCH_RUNS ?? 3))
const VIEWPORT = process.env.BENCH_VIEWPORT === 'mobile' ? 'mobile' : 'desktop'
const CPU_THROTTLE = Math.max(1, Number(process.env.BENCH_CPU_THROTTLE ?? 1))
const CDP_URL = process.env.BENCH_CDP
const PASSWORD = process.env.BENCH_PASSWORD
const PROFILE = process.env.BENCH_PROFILE === '1'
const OUT = process.env.BENCH_OUT

/** A switch counts as settled once the main thread has been free of long tasks this long. */
const QUIET_MS = 600
const SETTLE_TIMEOUT_MS = 120_000

type Control = 'mode' | 'hand'

interface Step {
  label: string
  control: Control
  value: string
}

/**
 * Every transition the practice screen handles differently, in an order that
 * reaches each one from a realistic previous state: the page/scroll remount,
 * entering and leaving the section crop, loop, and the hand switch in each of
 * the three layouts it behaves differently in (page, scroll, cropped section).
 */
const STEPS: Step[] = [
  { label: 'mode page -> scroll', control: 'mode', value: 'scroll' },
  { label: 'mode scroll -> section training', control: 'mode', value: 'sectionTraining' },
  { label: 'mode section training -> loop', control: 'mode', value: 'scrollLoop' },
  { label: 'mode loop -> page', control: 'mode', value: 'page' },
  { label: 'hand both -> right (page)', control: 'hand', value: 'right' },
  { label: 'hand right -> left (page)', control: 'hand', value: 'left' },
  { label: 'hand left -> both (page)', control: 'hand', value: 'both' },
  { label: 'mode page -> scroll (2)', control: 'mode', value: 'scroll' },
  { label: 'hand both -> right (scroll)', control: 'hand', value: 'right' },
  { label: 'hand right -> both (scroll)', control: 'hand', value: 'both' },
  { label: 'mode scroll -> section free', control: 'mode', value: 'sectionFree' },
  { label: 'hand both -> left (section)', control: 'hand', value: 'left' },
  { label: 'hand left -> both (section)', control: 'hand', value: 'both' },
  { label: 'mode section free -> page', control: 'mode', value: 'page' },
]

interface Measurement {
  /** The change handler itself, synchronous: React's event dispatch. */
  handlerMs: number
  /** Until the next frame could be produced, i.e. how long the screen stayed frozen at least. */
  nextFrameMs: number
  /** From the change until the main thread went quiet, follow-up effects included. */
  settledMs: number
  /** Sum and maximum of the long tasks (>50ms) seen in that window. */
  longTaskTotalMs: number
  longestTaskMs: number
  hotFunctions?: HotFunction[]
}

interface HotFunction {
  name: string
  selfMs: number
}

const SELECT_BY_CONTROL: Record<Control, string> = {
  // Matched by their options, which both the desktop and the mobile header share.
  mode: 'select:has(option[value="sectionFree"])',
  hand: 'select:has(option[value="left"])',
}

async function openBrowser(): Promise<{ browser: Browser; page: Page }> {
  if (CDP_URL) {
    const browser = await chromium.connectOverCDP(CDP_URL)
    const context = browser.contexts()[0] ?? (await browser.newContext())
    return { browser, page: await context.newPage() }
  }
  const browser = await chromium.launch()
  const context =
    VIEWPORT === 'mobile'
      ? await browser.newContext({
          viewport: { width: 915, height: 412 },
          deviceScaleFactor: 2.625,
          isMobile: true,
          hasTouch: true,
        })
      : await browser.newContext({ viewport: { width: 1600, height: 900 } })
  return { browser, page: await context.newPage() }
}

async function openScore(page: Page): Promise<void> {
  await page.goto(BASE_URL)
  const passwordField = page.locator('input[type="password"]')
  if (await passwordField.isVisible({ timeout: 1500 }).catch(() => false)) {
    if (!PASSWORD) {
      throw new Error('The server asks for a password: set BENCH_PASSWORD.')
    }
    await passwordField.fill(PASSWORD)
    await passwordField.press('Enter')
  }
  await page.getByRole('button', { name: /practice a score/i }).click()
  await page.getByPlaceholder('Search saved scores...').fill(SCORE_QUERY)
  // The listing is debounced, so wait for the row rather than for the request.
  // The whole row is the button that opens the score.
  const row = page.locator('ul li button', { hasText: SCORE_QUERY }).first()
  await row.waitFor({ timeout: 15_000 })
  await row.click()
  await page.locator(SELECT_BY_CONTROL.mode).waitFor({ timeout: 30_000 })
  await page.locator('svg g.vf-measure').first().waitFor({ timeout: 60_000 })
}

async function installLongTaskObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as { __benchLongTasks: Array<{ start: number; duration: number }> }
    store.__benchLongTasks = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        store.__benchLongTasks.push({ start: entry.startTime, duration: entry.duration })
      }
    }).observe({ type: 'longtask', buffered: false })
  })
}

/** Waits until no long task has started for QUIET_MS, and returns when the last one ended. */
async function waitUntilQuiet(page: Page, since: number): Promise<number> {
  return page.evaluate(
    async ({ since, quietMs, timeoutMs }) => {
      const store = window as unknown as { __benchLongTasks: Array<{ start: number; duration: number }> }
      const deadline = performance.now() + timeoutMs
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        // Inlined rather than a named helper: tsx compiles a named function in
        // here to a call of its own __name() helper, which the page lacks.
        const end = store.__benchLongTasks
          .filter((task) => task.start + task.duration >= since)
          .reduce((latest, task) => Math.max(latest, task.start + task.duration), since)
        if (performance.now() - end >= quietMs || performance.now() > deadline) {
          return end
        }
      }
    },
    { since, quietMs: QUIET_MS, timeoutMs: SETTLE_TIMEOUT_MS },
  )
}

async function measureStep(page: Page, cdp: CDPSession | null, step: Step): Promise<Measurement> {
  if (cdp) {
    await cdp.send('Profiler.start')
  }
  const timing = await page.evaluate(
    async ({ selector, value }) => {
      const select = document.querySelector<HTMLSelectElement>(selector)
      if (!select) {
        throw new Error(`No control matches ${selector}`)
      }
      if (![...select.options].some((option) => option.value === value)) {
        throw new Error(`${selector} has no option ${value}`)
      }
      const start = performance.now()
      select.value = value
      // React's onChange on a <select> is the native change event, dispatched
      // synchronously, so this returns once the handler (and the render React
      // flushes for a discrete event) is done.
      select.dispatchEvent(new Event('change', { bubbles: true }))
      const handlerEnd = performance.now()
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
      return { start, handlerMs: handlerEnd - start, nextFrameMs: performance.now() - start }
    },
    { selector: SELECT_BY_CONTROL[step.control], value: step.value },
  )
  const settledAt = await waitUntilQuiet(page, timing.start)
  const tasks = await page.evaluate((since) => {
    const store = window as unknown as { __benchLongTasks: Array<{ start: number; duration: number }> }
    return store.__benchLongTasks.filter((task) => task.start + task.duration >= since).map((task) => task.duration)
  }, timing.start)

  const selected = await page.locator(SELECT_BY_CONTROL[step.control]).inputValue()
  if (selected !== step.value) {
    throw new Error(`"${step.label}" did not take: the control shows ${selected}`)
  }

  const measurement: Measurement = {
    handlerMs: timing.handlerMs,
    nextFrameMs: timing.nextFrameMs,
    settledMs: Math.max(settledAt - timing.start, timing.nextFrameMs),
    longTaskTotalMs: tasks.reduce((sum, duration) => sum + duration, 0),
    longestTaskMs: tasks.reduce((longest, duration) => Math.max(longest, duration), 0),
  }
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop')
    measurement.hotFunctions = hotFunctions(profile)
  }
  return measurement
}

interface CpuProfile {
  nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number } }>
  samples?: number[]
  timeDeltas?: number[]
}

/** Self time per function, from a sampled CDP profile. */
function hotFunctions(profile: CpuProfile, limit = 8): HotFunction[] {
  const byNode = new Map(profile.nodes.map((node) => [node.id, node]))
  const selfMs = new Map<string, number>()
  const samples = profile.samples ?? []
  const deltas = profile.timeDeltas ?? []
  for (let i = 0; i < samples.length; i += 1) {
    const frame = byNode.get(samples[i])?.callFrame
    if (!frame || frame.functionName === '(idle)' || frame.functionName === '(program)') {
      continue
    }
    const file = frame.url.split('/').pop()?.split('?')[0] || '(native)'
    const name = `${frame.functionName || '(anonymous)'} ${file}:${frame.lineNumber + 1}`
    selfMs.set(name, (selfMs.get(name) ?? 0) + (deltas[i] ?? 0) / 1000)
  }
  return [...selfMs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, ms]) => ({ name, selfMs: Math.round(ms) }))
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length)
}

async function main(): Promise<void> {
  const { browser, page } = await openBrowser()
  try {
    const cdp = await page.context().newCDPSession(page)
    if (CPU_THROTTLE > 1) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })
    }
    if (PROFILE) {
      await cdp.send('Profiler.enable')
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
    }

    const loadStart = Date.now()
    await openScore(page)
    await installLongTaskObserver(page)
    // The first render's own follow-up work must not land in the first step.
    await waitUntilQuiet(page, await page.evaluate(() => performance.now()))
    const loadMs = Date.now() - loadStart

    // Every pass must start from the same state: page layout, both hands.
    const startMode = await page.locator(SELECT_BY_CONTROL.mode).inputValue()
    if (startMode !== 'page') {
      await measureStep(page, null, { label: 'reset', control: 'mode', value: 'page' })
    }

    const runs: Measurement[][] = []
    for (let run = 0; run < RUNS; run += 1) {
      const measurements: Measurement[] = []
      for (const step of STEPS) {
        measurements.push(await measureStep(page, PROFILE ? cdp : null, step))
      }
      runs.push(measurements)
      console.error(`run ${run + 1}/${RUNS} done`)
    }

    const summary = STEPS.map((step, index) => {
      const of = (key: keyof Omit<Measurement, 'hotFunctions'>) => Math.round(median(runs.map((run) => run[index][key])))
      return {
        step: step.label,
        handlerMs: of('handlerMs'),
        nextFrameMs: of('nextFrameMs'),
        settledMs: of('settledMs'),
        longestTaskMs: of('longestTaskMs'),
        longTaskTotalMs: of('longTaskTotalMs'),
        hotFunctions: runs[runs.length - 1][index].hotFunctions,
      }
    })

    const environment = {
      date: new Date().toISOString(),
      score: SCORE_QUERY,
      viewport: CDP_URL ? 'remote device' : VIEWPORT,
      cpuThrottle: CPU_THROTTLE,
      runs: RUNS,
      browser: browser.version(),
      loadMs,
    }
    console.log(
      `\n${environment.score} | ${environment.viewport} | cpu x${CPU_THROTTLE} | ${environment.browser} | median of ${RUNS} | load ${loadMs} ms\n`,
    )
    console.log(`${pad('switch', 36)}${pad('handler', 10)}${pad('frame', 10)}${pad('settled', 10)}${pad('longest', 10)}`)
    for (const row of summary) {
      console.log(
        `${pad(row.step, 36)}${pad(`${row.handlerMs}`, 10)}${pad(`${row.nextFrameMs}`, 10)}${pad(`${row.settledMs}`, 10)}${pad(`${row.longestTaskMs}`, 10)}`,
      )
      for (const hot of row.hotFunctions ?? []) {
        console.log(`    ${pad(`${hot.selfMs} ms`, 10)}${hot.name}`)
      }
    }
    // The longest task, not the next frame, is the freeze: a page/scroll switch
    // paints its frame immediately and then remounts OSMD from an effect.
    const worst = summary.reduce((max, row) => Math.max(max, row.longestTaskMs), 0)
    const total = summary.reduce((sum, row) => sum + row.longTaskTotalMs, 0)
    console.log(`\nworst freeze ${worst} ms, blocked time over one pass ${total} ms (all times in ms)`)

    if (OUT) {
      writeFileSync(OUT, `${JSON.stringify({ environment, summary, runs }, null, 2)}\n`)
      console.error(`written to ${OUT}`)
    }
  } finally {
    await browser.close()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
