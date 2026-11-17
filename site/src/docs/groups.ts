/**
 * The pages of the documentation sorted into the groups the side list shows,
 * in that order. Every page in `pages.ts` is in exactly one; a page left out
 * of every group would be a page no list leads to.
 */
export const DOC_GROUPS: readonly { readonly title: string; readonly slugs: readonly string[] }[] = [
  { title: 'Basics', slugs: ['getting-started', 'viewer', 'mask'] },
  { title: 'Map and buildings', slugs: ['ground', 'buildings', 'buildings-move'] },
  { title: 'Overlays', slugs: ['markers', 'shapes', 'images', 'extrusion', 'solids-models'] },
  { title: 'Analysis and appearance', slugs: ['viewshed', 'look'] },
  { title: 'Extending', slugs: ['extend'] },
]
