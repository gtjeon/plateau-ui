/**
 * The marking itself, and the line of text under the title.
 *
 * Nothing here touches the map. It draws the picture that goes into the roof —
 * a canvas of the page's own, which is how a roof picture gets its face — and
 * says how many roofs are marked, because a reader who has pressed one wants
 * to know the page noticed.
 */
import { PAD_INK, PAD_TEXELS } from './data.js'

/**
 * A helipad marking: a ring with an H in it.
 *
 * Drawn on nothing. What the library knows is the rectangle the picture fills,
 * so a marking that is round is round here, with the corners left clear — and
 * the roof shows through them exactly as it would show round a painted ring.
 */
export function helipad(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = PAD_TEXELS
  canvas.height = PAD_TEXELS
  const ink = canvas.getContext('2d')
  if (!ink) return canvas
  const middle = PAD_TEXELS / 2

  ink.strokeStyle = PAD_INK
  ink.lineWidth = PAD_TEXELS * 0.052
  ink.beginPath()
  ink.arc(middle, middle, PAD_TEXELS * 0.425, 0, Math.PI * 2)
  ink.stroke()

  ink.fillStyle = PAD_INK
  ink.font = `bold ${String(Math.round(PAD_TEXELS * 0.57))}px system-ui, sans-serif`
  ink.textAlign = 'center'
  ink.textBaseline = 'middle'
  // Nudged down: a capital H sits high in its line box, and a marking read
  // from above has nothing else on the roof to look level against.
  ink.fillText('H', middle, middle + PAD_TEXELS * 0.012)
  return canvas
}

/**
 * The running count, and what to say when a press lands somewhere else.
 *
 * A click that misses answers here too. The library says which face was
 * pressed, so the page can tell a wall from a roof without guessing — and a
 * reader who pressed a wall and saw nothing happen would otherwise think the
 * page was broken.
 */
export function ui(): { said: (marked: number) => void; missed: () => void } {
  const hint = document.getElementById('hint')
  return {
    said(marked: number): void {
      if (!hint) return
      hint.textContent =
        marked === 0 ? '屋上を押すと印が入ります。' : `${String(marked)}か所。もう一度押すと消えます。`
    },
    missed(): void {
      if (!hint) return
      hint.textContent = '屋上を押してください。'
    },
  }
}
