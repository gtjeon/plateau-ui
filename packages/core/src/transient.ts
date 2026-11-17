/**
 * Whether a response that failed may not fail when asked again: the server was
 * in trouble, or asked for a pause. Anything else it refuses is taken as its
 * answer, that there is nothing there.
 *
 * What is fetched once and held on to for the whole visit — a city's tiles, a
 * road tile, where a city keeps its land use — must not hold on to a failure
 * like this one, or a moment's trouble would leave a part of the map without
 * buildings, windows or green until the page is loaded again. Failing to
 * reach the server at all counts the same, and throws before any status.
 */
export function transient(status: number): boolean {
  return status >= 500 || status === 429
}

/**
 * A file that arrived and could not be read.
 *
 * The other kind of failure. {@link transient} judges an answer that never
 * came; this is one that came and turned out to be something else — a tile in
 * a form nothing here reads, a file cut short. Asking again brings back the
 * same bytes, so the asking has to stop, and it stops on what was thrown
 * rather than on a flag somebody remembered to set.
 *
 * Still said, though, and not swallowed: a hole with a reason is not the same
 * as a patch of city that was never built on. See `TileSet.fetchTile`, which
 * tells a page about this one and then lets the tile go.
 */
export class Unreadable extends Error {
  override readonly name = 'Unreadable'
}

/** Whether a failure is worth coming back to, or is the answer itself. */
export function worthAsking(error: unknown): boolean {
  return !(error instanceof Unreadable)
}
