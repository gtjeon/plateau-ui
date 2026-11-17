import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'

/**
 * The transcoder that opens a file whose pictures came compressed, shared by
 * whoever reads one.
 *
 * Beside `draco.ts` and for the same reason: there is one of these to a place
 * it is fetched from, not one to a layer, and each runs a pool of workers it
 * lets go of only when disposed.
 *
 * Two things set it apart from the decoder next door. It is brought in with a
 * dynamic import rather than a plain one, so a page with no models does not
 * carry the loader at all — nor `ktx-parse` and `zstddec`, which it pulls in
 * with it and which come to about a hundred kilobytes between the three of
 * them. A page that reads one glTF carries all of it whatever that file's
 * pictures turn out to be, and not by oversight: the loader has to be in
 * `GLTFLoader`'s hand before the file is opened, because the file is where it
 * would be found out that a picture came compressed, and by then it is too
 * late to go and fetch something (see `models/load.ts`). What does wait for a
 * KTX2 picture to actually be met is the transcoder itself, which three
 * fetches from the path below on the first one — 527kB of WebAssembly and 57
 * of glue, measured in the version pinned there. And it has to be
 * told what the device will take: a KTX2 file holds pictures in a form no card
 * reads directly, and which form they are transcoded into is an answer about
 * the card. That answer comes from the viewer, through
 * `Viewer.detectTextureSupport`, because the renderer is the viewer's and does
 * not leave it.
 */

/**
 * Where the transcoder is fetched from, unless a page says otherwise.
 *
 * Pinned to the version of three this library is built against, which is the
 * one place a matching pair of `basis_transcoder.js` and `.wasm` is published.
 * They are not fussy about the version they were shipped with — the pair reads
 * the file format, not three — so a page running another three is served by
 * this one; a page that would rather not reach jsDelivr serves its own copy of
 * that directory and says where.
 *
 * Three's own default is the pair beside its module, which only works where
 * the page's bundler has been told to copy them out of `node_modules`. A
 * library cannot ask that of whoever installs it.
 */
export const KTX2_PATH = 'https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/libs/basis/'

/**
 * One transcoder for each place it is fetched from, shared by every layer.
 *
 * Keyed by the path alone, as the Draco decoders are, though what it is told
 * about the device belongs to one viewer. Two viewers on a page are two
 * viewers on one card, and the one case that leaves wrong — a page running one
 * viewer on WebGPU and another fallen back to WebGL2 — is already wrong a
 * layer up: the files are cached by url in `models/load.ts`, and a picture
 * transcoded for the first device is the picture the second is handed whatever
 * is done here.
 */
const transcoders = new Map<string, Promise<KTX2Loader>>()

/** Who can answer what the device takes; the viewer, in practice. */
export type DetectsSupport = (loader: KTX2Loader) => Promise<void>

export function transcoderFrom(path: string, detect: DetectsSupport): Promise<KTX2Loader> {
  const held = transcoders.get(path)
  if (held) return held

  const made = (async () => {
    const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js')
    const loader = new KTX2Loader().setTranscoderPath(path)
    await detect(loader)
    return loader
  })()
  // A transcoder that was never told what the device takes throws on the first
  // picture it is handed, and would go on throwing for every file after it and
  // every layer made after that, until the page is loaded again. Failed, it is
  // forgotten and the next file asks afresh — the same care `draco.ts` takes
  // over its own decoder, and `models/load.ts` over a file that would not read.
  made.catch(() => {
    if (transcoders.get(path) === made) transcoders.delete(path)
  })
  transcoders.set(path, made)
  return made
}
