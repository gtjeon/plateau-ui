import { vec2 } from 'three/tsl'
import { texture } from './repaint.js'
import type { Texture, TextureNode } from 'three/webgpu'

/**
 * A texture to be read at places a shader works out — `.load(texel)`,
 * `.sample(at)`, `.depth(layer)` — and never at the corners' own `uv`: a
 * table of the city's styles, the land's heights, a picture thrown over the
 * walls. The value can be swapped under it later, as all of these are.
 *
 * Handed a place of its own, which nothing reads. Left without one, three
 * gives the node the geometry's `uv` to read at — and each read off it is a
 * copy holding the original as its reference, which a WebGL card builds too.
 * So on WebGL the original asks for `uv` on whatever it is drawn on, and the
 * city and the land have none: three filled the gap with nought and said so
 * once a material (measured 2026-11-05: `Vertex attribute "uv" not found on
 * geometry`, twice at every start, from the land's sheet and from the city).
 * A WebGPU card never builds the original, so it never asked.
 *
 * The place given also takes the texture's own transform out of every read.
 * Three multiplies a read by `texture.matrix` only where the node was made
 * without a place, and nothing here sets an offset, a repeat or a turn on a
 * texture, so that was a multiply by one.
 */
export function lookup(value: Texture): TextureNode {
  return texture(value, vec2(0, 0))
}
