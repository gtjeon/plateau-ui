/**
 * Each café's photograph.
 *
 * Files in `photos/`, cut to 21 by 9 when they were fetched. A wall is nearer
 * square than that, so each is cut again here to its wall's shape, from the
 * middle, rather than squeezed to fit — the library lays a picture as it is
 * shaped, and one given a width and a height both is stretched to them.
 */
import type { Cafe } from './data.js'

/**
 * Where a café's photograph is served from. The extension is written here
 * rather than in `data.ts` so the bundler, which takes in everything this
 * pattern could name, takes in the photographs and not the README beside them.
 */
export function photoUrl(cafe: Cafe): string {
  return new URL(`./photos/${cafe.photo}.jpg`, import.meta.url).href
}

/**
 * A café's photograph cut to its wall, once it has arrived.
 *
 * Waited for because a picture is copied in once, when it is put on a
 * building: one handed over before it has loaded goes on blank.
 */
export function photo(cafe: Cafe): Promise<HTMLCanvasElement> {
  const image = new Image()
  image.src = photoUrl(cafe)
  return image.decode().then(() => toWall(image, cafe.face))
}

/** The largest piece of the photograph shaped like the wall, from its middle. */
function toWall(image: HTMLImageElement, [wide, high]: readonly [number, number]): HTMLCanvasElement {
  const scale = Math.min(image.naturalWidth / wide, image.naturalHeight / high)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(wide * scale)
  canvas.height = Math.round(high * scale)
  canvas
    .getContext('2d')
    ?.drawImage(
      image,
      (image.naturalWidth - canvas.width) / 2,
      (image.naturalHeight - canvas.height) / 2,
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    )
  return canvas
}
