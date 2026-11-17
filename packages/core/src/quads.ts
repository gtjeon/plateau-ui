import type { Node, NodeMaterial, QuadMesh, RenderTarget, WebGPURenderer } from 'three/webgpu'

/**
 * Three's own corners for a quad laid over its whole target, kept once found;
 * see {@link quadCorners}.
 */
let corners: Node | null | undefined

/**
 * The corners `QuadMesh.render` puts on a quad's material for the length of a
 * draw.
 *
 * Three draws a quad over the whole target from the vertex's index rather
 * than from the quad's own geometry: `render` hangs a node of its own on the
 * material's `vertexNode`, draws, and takes it off again. Woven without it, a
 * quad is woven as a plain mesh with a buffer of corners, which is a shader
 * and a pipeline of its own and not the one the draw asks for — measured
 * 2026-11-17: the blur's four quads woven that way were all made again, on the
 * spot, the first time they were drawn.
 *
 * The node is not exported. It is found the one way three hands it over: by
 * asking a quad to draw into something that, instead of drawing, notes what
 * the quad's material wears.
 */
function quadCorners(quad: QuadMesh): Node | null {
  if (corners !== undefined) return corners
  const material = quad.material as NodeMaterial
  const noting = {
    render: () => {
      corners = material.vertexNode
    },
  }
  quad.render(noting as unknown as WebGPURenderer)
  return corners ?? null
}

/**
 * Weaves a quad's shader off the frame for the target it draws into: `null`
 * is the canvas, through the frame buffer the tone curve puts it in.
 *
 * Three's `compileAsync`, as `Viewer.weave` weaves the scene's things, with
 * the quad wearing the corners its draw will give it ({@link quadCorners})
 * until the weaving is done — it reads the material again as it builds, after
 * the walk. The target is set for the walk alone, which is where three takes
 * the shape it weaves for, and is also what has the target make its own
 * texture before anything reads it.
 */
export async function weaveQuad(
  renderer: WebGPURenderer,
  quad: QuadMesh,
  target: RenderTarget | null,
): Promise<void> {
  const material = quad.material as NodeMaterial
  const own = material.vertexNode
  material.vertexNode = quadCorners(quad)
  const to = renderer.getRenderTarget()
  const { depth, stencil } = renderer
  let woven: Promise<void>
  try {
    renderer.setRenderTarget(target)
    // A draw into a target takes the depth and the stencil the target has;
    // three's `compileAsync` takes the renderer's own, whatever the target.
    // Woven so, a target with no depth — the shading's filter draws into one —
    // was woven with a depth it never draws with, and made again on the spot
    // (measured 2026-11-17). Said as the target says it, for the walk
    if (target) {
      renderer.depth = target.depthBuffer
      renderer.stencil = target.stencilBuffer
    }
    woven = renderer.compileAsync(quad, quad.camera)
  } finally {
    renderer.depth = depth
    renderer.stencil = stencil
    renderer.setRenderTarget(to)
  }
  try {
    await woven
  } finally {
    material.vertexNode = own
  }
}
