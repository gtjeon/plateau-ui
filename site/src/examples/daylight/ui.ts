/**
 * The clock in the corner: which day of the two it is, what time it is, and
 * the handles that move both.
 *
 * The page's own markup and none of the library's. A day and an hour are a
 * page's furniture — what the library is told is a moment, and what it does
 * with it is work out where the sun stands and draw that. So anything that
 * moves a viewer looks like this: controls on the page, and one line handing
 * over what they say.
 *
 * On its own, because it is the one run on this page where the library is
 * never named. Where the moment goes is handed in.
 */
import { LAST, SEASONS, START, START_SEASON, STEP, momentOf, type Season } from './data.js'

/**
 * Fills the panel the markup left empty, and says what to do when either
 * control moves. Called once, when the page runs.
 *
 * The markup holds the shape — two days, a date, a reading, a handle — and
 * what goes in it comes from `data.ts`, so which days there are, where each
 * one starts and ends and how fine the handle is are written once and the page
 * and the map are pointing at the same instant.
 *
 * Both controls answer through `show`, and both hand over the pair: a day and
 * a moment on it. Which is why the chosen day is held here. It is the one
 * thing on this page a reader can set that the handle does not say, and the
 * reading the handle gives has no sun in it until it is said which day's.
 *
 * It does not call `show` to begin with. The viewer is built with the light of
 * `START` on `START_SEASON` already on it, off the same constants this sets
 * the controls to, and a page that lit itself twice would be saying it is not
 * sure which of the two is the starting light.
 */
export function ui(show: (season: Season, at: Date) => void): void {
  const slider = document.querySelector<HTMLInputElement>('#time')
  const now = document.querySelector<HTMLOutputElement>('#now')
  const day = document.querySelector<HTMLElement>('#day')
  const days = document.querySelector<HTMLElement>('#days')
  if (!slider || !now || !day || !days) return

  let season = START_SEASON

  // The reader's calendar, but Japan's day: the house's midnight is not the
  // reader's, and a page that named the day in the browser's zone would call
  // 冬至 the 21st for half the world
  const dated = (of: Season) =>
    momentOf(of, 0).toLocaleDateString('ja-JP', {
      month: 'long',
      day: 'numeric',
      timeZone: 'Asia/Tokyo',
    })

  const buttons: { of: Season; button: HTMLButtonElement }[] = []

  /**
   * Says which day is chosen, on the buttons and in the line under them.
   *
   * An arrow and not a declaration, which is the compiler's doing: a hoisted
   * function could have run before the guard above, so what it reads of the
   * markup is only known to be there inside one of these.
   */
  const mark = (): void => {
    for (const held of buttons) held.button.ariaPressed = String(held.of === season)
    day.textContent = dated(season)
  }

  // One button a day, made here rather than written into the markup, so that
  // the panel carries no day the map has never been lit by. Pressed is said
  // with `aria-pressed` and not with a class of this page's own invention: a
  // reader who cannot see which one is inked is told by the same attribute the
  // stylesheet is reading
  for (const of of SEASONS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = of.called
    button.addEventListener('click', () => {
      season = of
      // The slider is left exactly where it stands, which is the whole of what
      // makes the two days comparable — the same hour, asked of the other sun
      mark()
      show(season, momentOf(season, Number(slider.value)))
    })
    days.append(button)
    buttons.push({ of, button })
  }

  mark()

  slider.min = '0'
  slider.max = String(LAST)
  slider.step = String(STEP)
  slider.value = String(START)
  now.textContent = clock(START)

  // `input` and not `change`: the shadow is the answer to the question the
  // dragging is asking, and an answer that waits for the handle to be let go
  // is a page you have to guess at and then check
  slider.addEventListener('input', () => {
    const minutes = Number(slider.value)
    now.textContent = clock(minutes)
    show(season, momentOf(season, minutes))
  })
}

/**
 * The reading: 24:00 at the far end rather than tomorrow's 00:00.
 *
 * Worked out from the minutes and not from the `Date` they make, which is the
 * only way to say it — the two are the same instant, and a clock asked what
 * instant that is answers 00:00 of the day after.
 */
function clock(minutes: number): string {
  const hour = Math.floor(minutes / 60)
  return `${String(hour).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
