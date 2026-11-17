/**
 * Every request the library makes, through one door a page can stand at.
 *
 * Mapbox's `transformRequest`, by its name and its shape: a page that has to
 * go through a proxy, read from a mirror, sign a request or hold a dataset to
 * one year rather than `-latest` hands the viewer one function, and every
 * address the library would have fetched is put to it first. The addresses
 * themselves stay in the code, as they must (the data comes from those
 * servers and nowhere else); what a page changes is how they are reached.
 */

/**
 * What a request is for, so that a transform can treat the kinds apart.
 *
 * - `'elevation'`: the GSI's elevation tiles, the land's heights.
 * - `'mapTile'`: the GSI's vector tiles — the land's floor, and the roads
 *   the windows face.
 * - `'cities'`: PLATEAU's list of the cities it covers.
 * - `'catalog'`: PLATEAU's catalog of where a city's buildings and land use
 *   are — the tileset and tilejson files, with the year in their address.
 * - `'building'`: a tile of PLATEAU's buildings.
 * - `'landUse'`: a tile of PLATEAU's land use, which the green is.
 * - `'tile'`: a tile of a page's own `ImageTileLayer` or `VectorTileLayer`.
 * - `'image'`: the one picture of an `ImageLayer`.
 * - `'model'`: a model's file, and what the file names beside it.
 *
 * The decoders a model may need are reached by `dracoPath` and `ktx2Path`
 * and not through here: three's loaders fetch them for themselves.
 */
export type RequestKind =
  'elevation' | 'mapTile' | 'cities' | 'catalog' | 'building' | 'landUse' | 'tile' | 'image' | 'model'

/** What a transform hands back: where to go instead, and how. Mapbox's `RequestParameters`. */
export interface RequestParameters {
  /** The address to fetch in place of the one asked for. */
  readonly url: string
  /** Headers to send with it, beside any the library sends itself. */
  readonly headers?: Record<string, string>
  /** As `fetch` takes it. */
  readonly credentials?: RequestCredentials
}

/**
 * A page's say over a request: handed the address and what it is for, and
 * handing back where to go and how — or nothing, to go as asked.
 */
export type TransformRequest = (url: string, kind: RequestKind) => RequestParameters | null | undefined | void

/** How whatever fetches asks: the one door, with the kind beside the address. */
export type Ask = (url: string, kind: RequestKind, init?: RequestInit) => Promise<Response>

/** Asking as `fetch` does, for whatever is asked before there is a viewer to ask through. */
export const ASK_PLAINLY: Ask = (url, _kind, init) => fetch(url, init)

/** The door a viewer opens for a page's transform; plain `fetch` where it gave none. */
export function askThrough(transform: TransformRequest | undefined): Ask {
  if (!transform) return ASK_PLAINLY
  return (url, kind, init) => {
    const changed = transform(url, kind)
    if (!changed) return fetch(url, init)
    // The library's own headers stay — a Range asked for a building tile is
    // what makes the tile a third of its size — and the page's go beside them
    const headers = new Headers(init?.headers)
    for (const [name, value] of Object.entries(changed.headers ?? {})) headers.set(name, value)
    // An answer without an address keeps the one asked for, as
    // `addressThrough` does: a page's transform written in plain JavaScript can
    // leave it out, and `fetch(undefined)` asks the page's own origin for
    // `/undefined` with the page's headers on it (found in review)
    return fetch(changed.url ?? url, {
      ...init,
      headers,
      ...(changed.credentials !== undefined && { credentials: changed.credentials }),
    })
  }
}

/** Where a transform sends an address, for a reader that fetches by address alone (three's loaders). */
export function addressThrough(
  transform: TransformRequest | undefined,
  url: string,
  kind: RequestKind,
): string {
  return transform?.(url, kind)?.url ?? url
}
