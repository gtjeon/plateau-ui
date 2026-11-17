/**
 * Work long enough to hold a frame, written so that it can stop part way.
 *
 * A tile is shaped on the main thread (see the note in `Buildings.standTile`),
 * and three of the things done to it — reading its flat roofs, setting out its
 * windows, cutting its parapets — each run to tens of milliseconds on a phone,
 * on one mesh, in one call. Held whole, such a call is a frame that does not
 * come, and the light sweeping the footprints while the city arrives shows it
 * at once: the band jumps across the screen by however long the frame was held
 * (measured with the CPU slowed four times, a phone's sort of speed: up to 98ms
 * of windows, 53 of roofs and 39 of parapets, and several of them in a frame).
 *
 * So those calls are generators. They `yield` between pieces of their own loops
 * and do nothing else differently, and whoever drives them decides whether to
 * go on in this frame or the next. A caller that needs the answer now — a
 * parapet turned on over a tile that has already landed — runs them through to
 * the end with {@link atOnce} and gets what the plain function gave.
 *
 * A yield only ever stands between two pieces that leave nothing half written:
 * nothing shared across calls is held across one. What a step keeps between
 * pieces it keeps in its own locals, which a generator holds for it.
 */
export type Steps<T> = Generator<undefined, T, undefined>

/** Runs steps through to the end, for a caller that needs the answer now. */
export function atOnce<T>(steps: Steps<T>): T {
  for (;;) {
    const step = steps.next()
    if (step.done) return step.value
  }
}

/**
 * How many turns of a loop over triangles go by between two chances to stop.
 *
 * A turn of these loops is a handful of arithmetic over three corners, so a
 * chance taken every turn would cost more than the work; this many come to a
 * fraction of a millisecond on a phone, which is as finely as a frame needs
 * cutting. A power of two, so the test is a mask.
 */
export const TRIANGLES_BETWEEN = 2048

/** Whether a loop over triangles has come to a chance to stop. */
export function pause(t: number): boolean {
  return (t & (TRIANGLES_BETWEEN - 1)) === TRIANGLES_BETWEEN - 1
}
