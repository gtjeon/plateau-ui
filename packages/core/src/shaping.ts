/**
 * How long a layer may spend in one frame shaping what it fetched, and the
 * line what it fetched waits in.
 *
 * What a tile becomes — a vector tile parsed and cut into roads and water, a
 * building tile stood up and set with windows — is worked out on the main
 * thread as it lands. Done as each arrives, the arrivals bunch: a screenful
 * of tiles lands together, and with the CPU slowed four times, a phone's sort
 * of speed, ten of the land's were seen read in one gap between frames, and a
 * building tile's windows alone held one for 98ms. The light sweeping the
 * footprints while the city arrives shows every such gap, jumping across the
 * screen by however long it was.
 *
 * So what has been fetched waits for a turn, the frame hands turns out, and
 * once a layer has had this much of a frame the rest waits for the next.
 * Here and not in either layer because the land and the buildings are to keep
 * to the same share; see the rule on numbers two layers agree on.
 */

/**
 * The share, in milliseconds: half of a frame at 60 a second, leaving the other
 * half for drawing it. Measured in the time that passes rather than in pieces
 * of work, so a slow phone takes more frames over a tile and none of them
 * longer. Each layer keeps to it on its own, so a frame both are shaping in
 * can give twice this to them.
 */
export const SHAPE_FOR = 8

/**
 * The line one layer's tiles wait in to be shaped.
 *
 * The first in line goes each frame, whatever is left of it; each that is done
 * lets the next go at once, while this frame's share lasts. A tile given up on
 * while it waited is let go without holding anyone up: it finds its signal
 * aborted and leaves.
 */
export class ShapingTurns {
  private readonly waiting: { readonly go: () => void; readonly signal: AbortSignal }[] = []
  /** When the first of this frame's turns began, or null before one has. */
  private since: number | null = null

  /**
   * Waits for a turn. The clock starts when the first turn of a frame does,
   * not when the frame does: the frame's own drawing comes first, and is not
   * a layer's to count.
   */
  wait(signal: AbortSignal): Promise<void> {
    return new Promise<void>((go) => this.waiting.push({ go, signal })).then(() => {
      this.since ??= performance.now()
    })
  }

  /** A new frame, so a new share: the first in line goes. */
  frame(): void {
    this.since = null
    this.next()
  }

  /** Said by one whose turn is over: the next goes now if the share is not spent. */
  done(): void {
    if (this.since === null || performance.now() - this.since < SHAPE_FOR) this.next()
  }

  private next(): void {
    for (let next = this.waiting.shift(); next; next = this.waiting.shift()) {
      next.go()
      if (!next.signal.aborted) return
    }
  }
}
