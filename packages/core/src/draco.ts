import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'

/**
 * The decoder that opens a file whose corners came compressed, shared by
 * whoever reads one.
 *
 * Here rather than in either of the two that read files — the city's tiles and
 * a page's own models — because there is one of these to a place it is fetched
 * from and not one to a layer. Kept each of its own, a page drawing both
 * carried two of everything below, and the one version string was written in
 * two files where half of a change to it would have gone unnoticed.
 *
 * Global and not state, the way the fetched tiles in `elevation.ts` and
 * `cities.ts` are: made once and kept, holding nothing anybody can change.
 */

/** Where it is fetched from, unless a page says otherwise. */
export const DRACO_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/'

/**
 * One decoder for each place it is fetched from, shared by every layer.
 *
 * Each runs its own workers, up to four, and lets them go only when disposed.
 * One made for every layer stood up would leave its workers behind each time
 * the layer was made again, as the playground does whenever a setting baked
 * into the vertices changes, and fetch and compile the decoder over again
 * before the first tile. Shared, there is nothing to let go.
 */
const decoders = new Map<string, DRACOLoader>()

export function decoderFrom(path: string): DRACOLoader {
  let decoder = decoders.get(path)
  if (!decoder) {
    decoder = new DRACOLoader().setDecoderPath(path)
    forgetFailedFetch(decoder)
    decoders.set(path, decoder)
  }
  return decoder
}

/**
 * Three keeps its first try at fetching the decoder for good, so a try that
 * failed would fail every file after it and, shared, every layer made after it
 * too, until the page is loaded again. Failed, it is forgotten, and the next
 * file fetches the decoder afresh.
 */
function forgetFailedFetch(decoder: DRACOLoader): void {
  // Neither is in three's types, though both are there
  const own = decoder as unknown as { _initDecoder(): Promise<void>; decoderPending: Promise<void> | null }
  const init = own._initDecoder.bind(decoder)
  own._initDecoder = () => {
    const pending = init()
    pending.catch(() => {
      if (own.decoderPending === pending) own.decoderPending = null
    })
    return pending
  }
}
