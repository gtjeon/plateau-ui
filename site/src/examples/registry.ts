/**
 * What an example is, to the site.
 *
 * A page of its own, which the site shows in a frame. Nothing of the site
 * reaches into it and nothing of it reaches out: it runs when it loads, it is
 * cleaned up when the frame goes, and the files in its folder are exactly what
 * somebody using the library would write.
 */
export interface ExampleCard {
  /** The route, and the folder it lives in: `src/examples/<id>/`. */
  readonly id: string
  /** What it is called. Written once: the card and the page both read it here. */
  readonly title: string
  /**
   * What it is, in a sentence: which piece of the library does what. Read in
   * the same two places. A name in backticks is the library's own and is set
   * as code, as the galleries of other map libraries set theirs.
   */
  readonly blurb: string
  /** Where on the map it is, written small beside the title. */
  readonly place: string
  /** Which pieces of the library it is made with, one tag each. */
  readonly tags: readonly string[]
  /** Which shelf of the list it stands on; see {@link CATEGORIES}. */
  readonly category: Category
}

/**
 * The shelves the list is sorted onto, in the order its chips are laid out:
 * what the map is, what stands on it, what a page puts over it, pictures laid
 * on it, what it is asked, and what is brought in from outside the library.
 */
export const CATEGORIES = [
  'Map',
  'Buildings',
  'Markers and shapes',
  'Images',
  'Analysis',
  'Models and extending',
] as const

export type Category = (typeof CATEGORIES)[number]

/**
 * Where an example's page is served from, in development and once built
 * alike: Vite keeps a page where it found it.
 */
export function exampleUrl(id: string): string {
  return `${import.meta.env.BASE_URL}src/examples/${id}/index.html`
}

/**
 * The picture of an example, captured from that page by `tools/thumbs.mjs`.
 * Found by name like the page itself, so an example is still a folder and
 * nothing here has to be kept in step by hand.
 */
export function exampleThumb(id: string): string {
  return `${import.meta.env.BASE_URL}thumbs/${id}.webp`
}

export const EXAMPLES: readonly ExampleCard[] = [
  {
    id: 'simple-map',
    title: '基本の地図',
    blurb: '`Viewer`で地図を表示する。配色、輪郭線、チルトシフトを切り替えられる。',
    place: '中目黒',
    tags: ['Viewer', 'viewer.theme', 'buildings.edges', 'viewer.tiltShift'],
    category: 'Map',
  },
  {
    id: 'workspace',
    title: '複数の円で地図を切り抜く',
    blurb: '`mask`に円を四つ入れ、その内側だけを表示する。',
    place: '山手線の駅',
    tags: ['Mask', 'Solid', 'Marker', 'camera.flyTo'],
    category: 'Map',
  },
  {
    id: 'daylight',
    title: '太陽の位置を決める',
    blurb: '`viewer.sun`に日付と時刻を渡し、その時刻の影を表示する。',
    place: '鎌倉・七里ヶ浜',
    tags: ['viewer.sun', 'sunAt', 'buildings.bring', 'Solid', 'Polyline'],
    category: 'Analysis',
  },
  {
    id: 'guide-map',
    title: '経路を表示する',
    blurb: '`Marker`と`Polyline`で地図に経路を表示する。',
    place: '中野',
    tags: ['Marker', 'Polyline', 'AnnotationLayer', 'buildings.setStyle'],
    category: 'Markers and shapes',
  },
  {
    id: 'outlets',
    title: '区画内の建物を塗る',
    blurb: '`buildings.setStyle`に区画を渡し、その内側の建物だけを塗る。',
    place: '御殿場',
    tags: ['buildings.setStyle', 'MaskShape', 'elevation', 'Html', 'camera.flyTo'],
    category: 'Buildings',
  },
  {
    id: 'flood',
    title: '画像タイルを重ねる',
    blurb: '`ImageTileLayer`で画像タイルを地面と建物の壁に重ねる。',
    place: '鎌倉・由比ヶ浜',
    tags: ['ImageTileLayer', 'paints', 'colorAt', 'buildings.setStyle'],
    category: 'Images',
  },
  {
    id: 'helipad',
    title: '屋上に画像を貼る',
    blurb: '`buildings.setStyle`の`roofImage`で建物の屋上に画像を貼る。',
    place: '丸の内',
    tags: ['buildings.setStyle', 'roofImage', 'Anchor'],
    category: 'Buildings',
  },
  {
    id: 'riverside-cafes',
    title: '壁に画像を貼る',
    blurb:
      '`buildings.setStyle`の`wallImage`で建物の壁に写真を貼る。マウスを乗せると建物が大きくなって`outline`で囲まれ、クリックするとそのまま残る。',
    place: '中目黒・目黒川',
    tags: ['buildings.setStyle', 'wallImage', 'outline', 'buildings.animate', 'Html', 'Mask'],
    category: 'Buildings',
  },
  {
    id: 'airstay',
    title: '3Dモデルを置く',
    blurb: '`viewer.models.bring`で`glTF`のモデルを地図に置く。',
    place: '鎌倉・七里ヶ浜',
    tags: ['models.bring', 'Html', 'AnnotationLayer', 'camera.flyTo'],
    category: 'Models and extending',
  },
  {
    id: 'tallest',
    title: '建物を選んで読み込む',
    blurb: '`buildings.bring`で指定した建物だけを読み込む。',
    place: '全国の高い建物五つ',
    tags: ['buildings.bring', 'Html', 'Solid', 'Polyline'],
    category: 'Buildings',
  },
  {
    id: 'wards',
    title: 'GeoJSONの形を塗る',
    blurb: '`GeoJsonLayer`で区の形を地面と建物に塗る。',
    place: '湯島',
    tags: ['GeoJsonLayer', 'paints'],
    category: 'Markers and shapes',
  },
  {
    id: 'zilla',
    title: '建物をまとめて動かす',
    blurb: '`buildings.animateAll`ですべての建物をキーフレームで動かす。',
    place: '虎ノ門',
    tags: ['buildings.animateAll', 'models.bring', 'Solid', 'Mask'],
    category: 'Buildings',
  },
  {
    id: 'flood-hours',
    title: '3D化画像タイルを表示する',
    blurb: '`ImageExtrusionTileLayer`で画像タイルの色を凡例に沿って高さに変える。',
    place: '台東区駒形',
    tags: ['ImageExtrusionTileLayer', 'Mask'],
    category: 'Images',
  },
  {
    id: 'security-camera',
    title: '見える範囲を塗る',
    blurb: '`Viewshed`で一点から見える範囲を塗る。',
    place: '新宿三丁目',
    tags: ['Viewshed', 'sees', 'Solid', 'Marker', 'Anchor'],
    category: 'Analysis',
  },
  {
    id: 'fireworks',
    title: '独自のレイヤーを追加する',
    blurb: '`three.js`で作った`Layer`を地図に追加する。',
    place: 'みなとみらい',
    tags: ['Layer', 'three.js', 'marksSolid'],
    category: 'Models and extending',
  },
]

export function exampleById(id: string | undefined): ExampleCard | undefined {
  return EXAMPLES.find((example) => example.id === id)
}
