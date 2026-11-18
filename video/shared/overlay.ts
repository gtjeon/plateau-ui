/**
 * What sits over every frame of the video, whichever shot it is from: the
 * line in the corner saying the picture is the library itself, and the name
 * of the part along the top.
 *
 * Both are drawn the same way, at the same place, by every shot page, so a cut
 * from one recording to the next does not move them.
 *
 * The map's own line of sources is put away here too. The video names its
 * sources once, on the card it ends on (`shots/outro`), rather than in a corner
 * that changes with every scene.
 */

const STYLE = `
.plateau-credits { display: none !important; }

#note {
  position: absolute;
  left: 40px;
  bottom: 6px;
  z-index: 20;
  padding: 1px 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.82);
  color: #4a5260;
  font: 600 12px/1.5 'Hiragino Sans', 'Noto Sans JP', system-ui, sans-serif;
  letter-spacing: 0.04em;
}

#part {
  position: absolute;
  left: 50%;
  top: 8px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 24px 8px 20px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 4px 18px rgba(20, 30, 45, 0.18);
  font: 700 22px/1.4 'Hiragino Sans', 'Noto Sans JP', system-ui, sans-serif;
  letter-spacing: 0.04em;
  color: #1f2933;
  white-space: nowrap;
  transform-origin: 50% 0;
  opacity: 0;
}
#part .number {
  font-family: 'SF Pro Display', 'Helvetica Neue', system-ui, sans-serif;
  font-size: 17px;
  color: #f08a4b;
  letter-spacing: 0.06em;
}
#part .rule {
  width: 1px;
  height: 20px;
  background: #d3d8de;
}
`

/** Hides sources only a frame inside the page draws (an example in an iframe). */
export function quiet(doc: Document): void {
  const style = doc.createElement('style')
  style.textContent = '.plateau-credits { display: none !important; }'
  doc.head.append(style)
}

export function note(): void {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)
  const line = document.createElement('div')
  line.id = 'note'
  line.textContent = '本映像は、実際のライブラリを操作した画面です。'
  document.body.append(line)
}

/** How long the part's name takes to come in and settle; the part starts after it. */
export const PART_IN = 1.6

/**
 * The part's name at the top in the middle. Returns what moves it: from `from`
 * it comes down large into the upper middle of the frame, holds a moment, and
 * goes up to the top at its own size, all within `PART_IN`; then it stays.
 * Before `from` it is not there.
 */
export function part(number: string, name: string): (t: number, from: number) => void {
  const label = document.createElement('div')
  label.id = 'part'
  const n = document.createElement('span')
  n.className = 'number'
  n.textContent = number
  const rule = document.createElement('span')
  rule.className = 'rule'
  const text = document.createElement('span')
  text.textContent = name
  label.append(n, rule, text)
  document.body.append(label)

  const LARGE = 1.9
  /** Where its top is while it is large: a little above the middle of the frame. */
  const LOW = 250
  const clamp = (x: number): number => Math.min(1, Math.max(0, x))
  const easeOut = (x: number): number => 1 - (1 - x) ** 3
  const easeInOut = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
  return (t, from) => {
    const s = t - from
    const down = easeOut(clamp(s / 0.5))
    const up = easeInOut(clamp((s - 1.0) / 0.55))
    const y = (-140 + (LOW + 140) * down) * (1 - up)
    const scale = LARGE + (1 - LARGE) * up
    label.style.opacity = String(clamp(s / 0.25))
    label.style.transform = `translate(-50%, ${y.toFixed(2)}px) scale(${scale.toFixed(4)})`
  }
}
