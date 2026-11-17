/**
 * The picture on an example's card.
 *
 * A card says what the example looks like, and what it looks like is a page
 * that draws a city on the GPU. So the picture is a capture of that page,
 * taken by a browser that actually ran it — nothing here is drawn by hand, and
 * running this again follows whatever the examples have become.
 *
 * A still rather than the page itself in a frame: the list shows every example
 * at once, so a live map per card is a GPU device per card and a set of tiles
 * fetched for each of them before anybody has picked one.
 *
 * What is captured is the city alone — no panel, no line of sources. The panel
 * an example lays over its map is that page's own furniture, and a wall of
 * cards showing panels says less about the library than the same wall of
 * cities does; the small print, at the size a card is read, is read as the
 * card's own caption. Both stand where they belong, which is on the pages.
 *
 * Chrome headless does the running. It has no `navigator.gpu` without
 * `--enable-unsafe-webgpu` (measured: the flag is what makes an adapter
 * appear), and it is driven over the devtools protocol rather than by
 * `--screenshot` so the shot is taken when the city has landed rather than at
 * a guessed moment.
 *
 *   site running (pnpm dev, port 5181), then:
 *   node tools/thumbs.mjs [id ...] [--frames N]
 *   node tools/thumbs.mjs simple-map --hero
 *   node tools/thumbs.mjs simple-map --hero-portrait
 */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SITE = process.env.SITE_URL ?? 'http://localhost:5181'
const DEBUG_PORT = 9333

/** The shape of the card (16:10), so what is captured is what is shown. */
const WIDTH = 1120
const HEIGHT = 700

/** Long enough that a reader zooming the card sees a picture, small enough to ship one per example. */
const QUALITY = 82

/**
 * An example fetches its tiles as it goes, so "loaded" says nothing about
 * whether the city is there. What says so is the page having asked for
 * nothing for a while — and then a moment more, because the last tiles to
 * land are still rising when they stop being fetched.
 */
const QUIET = 2000
const SETTLE = 2500
const LIMIT = 40_000

/**
 * What a shot is of, where the page opening at its own view is not it.
 *
 * Reached the way a reader would reach it — pressing what they would press,
 * turning the wheel where they would turn it — so a card shows a state the
 * page really has rather than one arranged behind its back. `then` is how
 * long that takes to arrive, and it is waited out before the next step: a
 * flight has to land before the wheel is turned, or the turn stops it
 * halfway.
 *
 * `frame` is the screen the page is given. It is the card's shape whatever
 * size it is, and a smaller one is not a smaller picture of the same view —
 * it is the same city on a smaller screen, which is the only thing that makes
 * what the viewer draws at a size in pixels, a mark or a plate, large in the
 * frame. Pulling the camera back by as much then puts the city back the size
 * it was and leaves the plate big: the two together are how a card is framed
 * on the city and on the writing over it separately. Taken at twice the
 * pixels so that it is still sharp on the card.
 *
 * `say` is the one step that is not a reader's move: it runs a line on the
 * page. Everything else here reaches a state the page can be got into by
 * pressing and turning, and that is the rule — a card showing something a
 * reader cannot get to is a card that lies. This is for the one thing a
 * smaller screen cannot buy: a mall a kilometre across has the card's whole
 * width and no more, so the trick that makes pixel-sized things large in the
 * frame is out, and a letter left at its own size is a full stop on a card.
 * What it may say is how big something is drawn, and nothing else.
 *
 * `drag` is a press, a pull and a let-go, as a reader drags the map: the left
 * button pans and the right one turns and tilts it. `by` is how far, in pixels
 * of the screen, and `from` where the press comes down on the card — the
 * middle unless a page says otherwise. The viewer moves the view by what the
 * pointer moved and nothing else, so the same pull lands the same view every
 * run.
 *
 * `click` is a press and a let-go in one place, as a reader clicks the map;
 * `at` is where on the card. The pointer is left there, as a reader's hand
 * is, so what it came down on is still the thing pointed at when the shot is
 * taken.
 *
 * `drop` moves what is looked at down the picture, and `shift` moves it right;
 * either goes the other way when it is negative. The view is centred on the
 * screen it is given, and that is not where the picture wants it: what stands
 * on the middle — a house, a creature — is drawn upwards from it, and a page
 * that lays a panel down one side frames its map clear of the panel. The page
 * is handed a screen larger by twice the move and the far side of it is kept,
 * which shifts everything without touching what the page thinks it is
 * showing; a drag would not do, since a page that carries the view itself, as
 * the one with the creature does, takes it back within the second.
 */
const SHOTS = {
  airstay: {
    // The plate over the roof is drawn at a size on the screen rather than on
    // the ground, so no amount of flying towards the house makes it any
    // bigger. A small screen does, and the camera is pulled back the same
    // amount to leave the house the size it was: the price ends up a third of
    // the width of the house it stands over and can be read off the card.
    //
    // The drop is for the plate: the view is centred on the ground the house
    // stands on, and the house, and then the price above that, are all above
    // that point.
    frame: { width: 360, height: 225, scale: 2, drop: 45 },
    steps: [
      // One stay rather than the hillside of them: the card for the house
      // with the garage, which is what the page flies to when it is picked.
      { press: '#stays li:nth-of-type(4)', then: 4500 },
      // And back out from where the page lands, which is as close as the
      // viewer goes and far closer than a screen this size wants.
      { wheel: { notches: 4 }, then: 2500 },
    ],
  },
  flood: {
    // The page opens in the street, which is where a reader reads the water
    // against the walls of the houses next to them. A card is looked at once
    // and at a twelfth the width, so it is pulled back to where the beach,
    // the band the water reaches and the town standing in it are all in the
    // frame together — which is the one thing this example is about.
    steps: [{ wheel: { notches: 5 }, then: 3000 }],
  },
  'flood-hours': {
    // The page opens in the street, looking up it, which is where a reader
    // reads the steps against the walls next to them. A card is looked at once,
    // so it is framed as a photograph of the place rather than a view from it:
    // the town massed in the top left, the deep band running off from it on a
    // diagonal from the bottom left to the top right, and the shorter bands
    // stepping down beside it in the bottom right, where the eye ends up.
    steps: [
      // Turned 27° to the left and laid 4° further back (a quarter of a degree a
      // pixel), so the edge of the deep band is the diagonal across the card
      { drag: { button: 'right', by: [108, 16] }, then: 500 },
      // One notch out, 0.4 of zoom, for the town round the street as well
      { wheel: { notches: 1 }, then: 1500 },
      // And the street pulled 196 pixels left, which puts the town on the left
      // third and the stepping bands on the right one. Measured off the page
      // rather than guessed: where 36 m east of the street falls on this screen
      { drag: { button: 'left', from: [756, 359], by: [-196, -9] }, then: 3000 },
    ],
  },
  helipad: {
    // The page opens centred on the ground the tower stands on, and the thing
    // worth looking at is the marking — which is a hundred metres above that
    // point and, at this heading, off to one side of it as well. Left alone
    // the card has the ring up in its top left corner with the street the
    // tower stands in taking the middle.
    //
    // Measured off the capture rather than guessed: the ring's red pixels came
    // out centred 61 left and 125 up of the middle of the frame, so the view
    // is moved by exactly that.
    frame: { shift: 61, drop: 125 },
  },
  daylight: {
    // The page opens with room round the ring, because a reader drags the
    // handle and watches the ball go round the whole of it. A card is looked
    // at once and at a twelfth the width, so the same room reads as a house
    // lost in a field of white.
    //
    // One notch, which is 0.4 of zoom and about a third again as large. It was
    // two while there was one road to fit: the page draws both solstices now
    // and midsummer's goes nearly twice as high as midwinter's — at two
    // notches the top of it was a couple of hundred pixels above the card, so
    // the card showed two lines leaving the picture and never said that one of
    // them is an arc at all.
    //
    // Turned over the middle, since that is where the ring is centred and the
    // house stands on it.
    steps: [{ wheel: { notches: -1 }, then: 2000 }],
    // The view is centred on the ground the house stands on, and everything
    // worth looking at is drawn upwards from there — the house, then the low
    // road over it, then the high one over that. Left alone the card holds a
    // band of empty sheet along the bottom and crowds the roofs against the
    // top. Twice what it was, for the second road's sake: the headroom a
    // summer arc wants is the headroom a winter arc wants doubled.
    frame: { drop: 110 },
  },
  tallest: {
    // A small screen, for the plates over the roofs: five of them written at
    // a size in pixels are a caption apiece on a card this wide, and half the
    // screen makes them twice the picture.
    //
    // The shift is the page's own framing undone. The page stands the row off
    // to one side of the middle, to leave the sky over the tallest of them in
    // the frame, so a card cut from the middle would open on the empty half.
    frame: { width: 560, height: 350, scale: 2, shift: 210, drop: 30 },
    // Turned in over the tower at 芝公園 rather than over the middle of the
    // screen: the wheel holds still whatever is under it, so where it is
    // turned is what decides which of the five the card is of. Two notches
    // leaves three of them across the card with the outer two cut by its
    // edges — enough to say it is a row without the row being the picture.
    steps: [{ wheel: { at: [318, 75], notches: -2 }, then: 2000 }],
  },
  outlets: {
    // Shot at the card's own width. A smaller screen was tried for the letters'
    // sake — they are drawn at a size in pixels, so they grow against a smaller
    // city — and at half the width the mall no longer fits: it is nearly a
    // kilometre of shallow site, and the card is all the room it has.
    //
    // And this is the one page here whose map does not fill the window: the
    // leaflet under it takes the bottom, and the credits line stands in the
    // corner of what is left. So the screen is taller than the card by enough
    // that the map alone is taller still — 1200 leaves 744 of map for a 700
    // card — and the card is cut from the top. What falls below the cut is the
    // small print and then the sheet, which is the page's own furniture and
    // belongs on the page.
    frame: { drop: 250 },
    // The letters are drawn at a size in pixels of the page, so on a card that
    // is the page at two thirds they come out as three coloured full stops.
    // Told to be half as big again, they read as letters and the reader of a
    // card sees what the reader of the page sees.
    steps: [
      {
        say: "document.querySelectorAll('.letter.over-map').forEach((el) => { el.style.width = el.style.height = '72px'; el.style.fontSize = '32px' })",
        then: 400,
      },
    ],
  },
  zilla: {
    // A hundred metres of creature stands a long way up from the ground it is
    // centred on, so the drop here is most of what puts it in the picture.
    frame: { drop: 150 },
    // Close in on the creature. Four notches of the wheel towards where it
    // walks — the camera trails it near the middle of the frame — which is
    // 1.6 of zoom, from the district to the blocks it is standing in.
    //
    // The card wants the city off the ground, and a block is only in the air
    // for about a second after a footfall, so this one is shot as a burst
    // (`--frames 30`) and the frame that has it is picked by eye. One run of
    // this on its own lands wherever the walk happens to be.
    steps: [{ wheel: { notches: -4 }, then: 2500 }],
  },
  'security-camera': {
    // The page opens on the whole square, which is where a reader sees how far
    // the camera reaches. A card is looked at once, so it is framed as a
    // photograph of the two things the page is about and nothing else: the
    // camera on its wall on the top-left third, its lens turned down to the
    // right, and on the bottom-right third the one pin it sees, standing in the
    // paint it looks out over. The other two marks are left out of the frame.
    //
    // The small screen is for the pin, as it is for the price in `airstay`: a
    // mark is drawn at a size on the screen, so a screen a third as wide makes
    // it three times the size in the picture, and the wheel brings the camera
    // back to the size the card wants.
    frame: { width: 360, height: 225, scale: 2 },
    steps: [
      // Turned 75° to the left (a quarter of a degree a pixel), so the line from
      // the camera down to the pin runs from the top left to the bottom right
      { drag: { button: 'right', by: [300, 0] }, then: 600 },
      // Six notches in, 1.2 of zoom on this screen (measured: 18.5 to 19.7)
      { wheel: { notches: -6 }, then: 1800 },
      // And the view pulled down and right, which puts the camera on its third
      // and drops the tag on the wall below the bottom of the frame. Measured
      // off the page: where the camera's place fell on this screen, and where
      // it was wanted
      { drag: { button: 'left', by: [66, 102] }, then: 3500 },
    ],
  },
  'riverside-cafes': {
    // A card of the page with one café picked, since picking is what the page
    // does: grown over its street, the line round it, and its name over it.
    //
    // A small screen for the name, which is drawn at a size on the screen, as
    // the price is in `airstay`; five notches in at the middle bring the city
    // back to fill the card from side to side.
    frame: { width: 560, height: 350, scale: 2 },
    steps: [
      { wheel: { notches: -5 }, then: 2500 },
      // On the wall of かわべり珈琲, the café in front on this bank. Measured off
      // the page: where its card stands over the roof on this screen, and a
      // little under that
      { click: { at: [172, 205] }, then: 1500 },
    ],
  },
}

/** The screen an example is given when it asks for nothing else. */
const FRAME = { width: WIDTH, height: HEIGHT, scale: 1, drop: 0, shift: 0 }

/**
 * The picture across the top of the home page, given `--hero` and one example:
 * the page's own first view on a wide screen, at half again the pixels, written
 * to `public/hero.webp` rather than to a card. A card blown up to the width of a
 * window is a card seen through frosted glass.
 *
 * Moved right by an eighth of the width: the tower the page opens on stands
 * on the right third rather than dead centre, across from the words laid
 * over the bottom left, which is what keeps the picture at rest (the user
 * asked for it).
 */
const HERO = { width: 1440, height: 720, scale: 1.5, drop: 0, shift: 170 }

/**
 * The same picture for a phone, given `--hero-portrait`: taken upright at a
 * phone's width and twice its pixels, to `public/hero-portrait.webp`. The wide
 * one cut down to a phone's shape left the tower under the words, so this one
 * is framed for the shape: the view lifted, so the tower stands in the upper
 * part and the blurred street in front of it fills the lower part, which is
 * where the words go.
 */
const HERO_PORTRAIT = { width: 390, height: 680, scale: 2, drop: -60, shift: 50 }

const examples = fileURLToPath(new URL('../src/examples/', import.meta.url))
const thumbs = fileURLToPath(new URL('../public/thumbs/', import.meta.url))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Which examples to shoot: the folders, since that is what an example is. */
const args = process.argv.slice(2)
/** How many shots of each, where one is not enough to catch what is wanted. */
const takes = Math.max(1, Number(args[args.indexOf('--frames') + 1]) || 1)
const asked = args.filter((arg) => !arg.startsWith('--') && !/^\d+$/.test(arg))
const portrait = args.includes('--hero-portrait')
const hero = portrait || args.includes('--hero')
if (hero && asked.length !== 1) throw new Error('--hero shoots one example: name it')
const folders = (await readdir(examples, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
/**
 * An id that names no folder is a typo, and a typo silently shoots nothing.
 * Asked before the browser exists so the throw has nothing to put away:
 * reading the folders needs no Chrome, and a Chrome left running holds
 * DEBUG_PORT — which is all `attach()` goes by, so the next run would drive
 * the orphan and put away its own child instead.
 */
const missing = asked.filter((id) => !folders.includes(id))
if (missing.length > 0) throw new Error(`No example named ${missing.join(', ')}`)
const ids = folders.filter((id) => asked.length === 0 || asked.includes(id))

/**
 * A browser of its own: a fresh profile in the temp directory, never the one
 * the person browses with.
 */
const profile = await mkdtemp(join(tmpdir(), 'plateau-thumbs-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
)

/** The page Chrome opened with, once it is answering. Every example is shot in it. */
async function attach() {
  for (let tries = 0; tries < 80; tries++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json())
      const page = targets.find((target) => target.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {
      // Not up yet.
    }
    await sleep(250)
  }
  throw new Error(`Chrome never answered on ${DEBUG_PORT}`)
}

/**
 * From here on there is a browser to put away, so every path out of the run
 * goes through the cleanup below — including the throws, which used to leave
 * the child and its profile behind.
 */
let socket
try {
  socket = new WebSocket(await attach())
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))

  let nextId = 1
  const answers = new Map()
  /** When the page last asked for something, and how much is still out. */
  let inflight = 0
  let stirred = Date.now()

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const answer = answers.get(message.id)
    if (answer) {
      answers.delete(message.id)
      if (message.error) answer.reject(new Error(`${answer.method}: ${message.error.message}`))
      else answer.resolve(message.result)
      return
    }
    if (message.method === 'Network.requestWillBeSent') inflight++
    else if (message.method === 'Network.loadingFinished') inflight--
    else if (message.method === 'Network.loadingFailed') inflight--
    else return
    stirred = Date.now()
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      answers.set(id, { resolve, reject, method })
      socket.send(JSON.stringify({ id, method, params }))
    })

  await send('Page.enable')
  await send('Network.enable')

  /** Waits for the page to stop asking for things, then for what landed to settle. */
  async function landed() {
    const started = Date.now()
    while (Date.now() - started < LIMIT) {
      await sleep(250)
      if (inflight <= 0 && Date.now() - stirred > QUIET) break
    }
    await sleep(SETTLE)
  }

  const run = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true })

  /**
   * A turn of the wheel over the map, which is how a reader zooms.
   *
   * About the middle of the screen unless a page says otherwise: the viewer
   * holds whatever is under the cursor still as it zooms, so turning anywhere
   * else would take the view with it.
   *
   * `at` is a point on the card, which is what a recipe is written looking at,
   * and the wheel is turned on the screen the card is cut out of — so it is
   * moved by the same corner the cut is made from. That corner is (0, 0) in every
   * recipe there is, none of them having a negative move, so today the offset adds
   * nothing; it is what keeps `at` meaning the same point on the card in one that
   * does, where the cut comes off the far side of the screen and the point sits
   * twice the move further in.
   */
  async function turn({ at, notches }, screen, corner) {
    const [x, y] = at ? [at[0] + corner.x, at[1] + corner.y] : [screen.width / 2, screen.height / 2]
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX: 0,
      deltaY: notches * 100,
      pointerType: 'mouse',
    })
  }

  /** A click on the map, left where it came down; see `click` on {@link SHOTS}. */
  async function click({ at }, screen, corner) {
    const [x, y] = [at[0] + corner.x, at[1] + corner.y]
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
  }

  /**
   * A drag over the map, which is how a reader pans it, turns it and tilts it.
   *
   * The pull goes in steps rather than one jump, as a hand's does: the viewer
   * adds up what each move moved, so the steps come to the same `by`, and a
   * single move would be one the page might read as a click that slipped.
   * `from` is a point on the card, moved by the corner as the wheel's is.
   */
  async function pull({ button = 'left', from, by }, screen, corner) {
    const [x, y] = from ? [from[0] + corner.x, from[1] + corner.y] : [screen.width / 2, screen.height / 2]
    const buttons = button === 'right' ? 2 : 1
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount: 1 })
    const STEPS = 12
    for (let step = 1; step <= STEPS; step++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: x + (by[0] * step) / STEPS,
        y: y + (by[1] * step) / STEPS,
        button,
        buttons,
      })
      await sleep(16)
    }
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: x + by[0],
      y: y + by[1],
      button,
      buttons: 0,
      clickCount: 1,
    })
  }

  /**
   * Everything but the map put away, and the viewer's line of sources with it.
   *
   * A card is three hundred pixels of picture, and small print across the foot
   * of one is read as a caption to the card rather than as the map saying where
   * its city came from. The pages themselves carry the line, which is where
   * showing the data is conditional on it.
   */
  const BARE = `
    for (const node of document.body.children) if (node.id !== 'map') node.style.display = 'none'
    for (const line of document.querySelectorAll('.plateau-credits')) line.style.display = 'none'
  `

  /**
   * More than one take goes somewhere to be looked through rather than onto the
   * cards: it is for the pages where the picture wanted is a moment — the city
   * off the ground after a footfall — and which frame that is, is a thing a
   * person decides.
   */
  const out = takes > 1 ? await mkdtemp(join(tmpdir(), 'plateau-frames-')) : thumbs
  await mkdir(out, { recursive: true })

  for (const id of ids) {
    // The hero is the page as it opens, so the card's own framing is not used
    const shot = hero ? undefined : SHOTS[id]
    const frame = portrait ? HERO_PORTRAIT : hero ? HERO : { ...FRAME, ...shot?.frame }
    /** What the page is given: the card, and twice each move around it. */
    const screen = {
      width: frame.width + 2 * Math.abs(frame.shift),
      height: frame.height + 2 * Math.abs(frame.drop),
    }
    /** The corner of that screen the card is cut from: the side the move comes off. */
    const corner = {
      x: frame.shift >= 0 ? 0 : 2 * -frame.shift,
      y: frame.drop >= 0 ? 0 : 2 * -frame.drop,
    }
    await send('Emulation.setDeviceMetricsOverride', {
      width: screen.width,
      height: screen.height,
      deviceScaleFactor: frame.scale,
      mobile: false,
    })

    inflight = 0
    stirred = Date.now()
    const started = Date.now()
    const arrival = await send('Page.navigate', { url: `${SITE}/src/examples/${id}/index.html` })
    // A navigation that failed leaves a page to shoot all the same, and the shot
    // would be written over the card that was there.
    if (arrival.errorText) throw new Error(`${id}: ${arrival.errorText}`)
    await landed()

    /*
     * Put away first, then the steps. A press goes through whether the thing
     * pressed is on the screen or not, and a wheel turned over a panel is a
     * wheel the map never hears — on a screen this small the panel is most of
     * the middle of it.
     */
    await run(BARE)

    for (const step of shot?.steps ?? []) {
      if (step.press) await run(`document.querySelector('${step.press}')?.click()`)
      if (step.say) await run(step.say)
      if (step.wheel) await turn(step.wheel, screen, corner)
      if (step.drag) await pull(step.drag, screen, corner)
      if (step.click) await click(step.click, screen, corner)
      if (step.then) await sleep(step.then)
    }

    await sleep(300)

    for (let take = 1; take <= takes; take++) {
      // Cut at `corner`, which is the side of the screen the moves come off: the
      // top left while neither move is negative — zero included — and twice the
      // move in from the far side on an axis whose move is negative.
      const { data } = await send('Page.captureScreenshot', {
        format: 'webp',
        quality: QUALITY,
        // In pixels of the page, which the screen is already drawn twice over.
        clip: { ...corner, width: frame.width, height: frame.height, scale: 1 },
      })
      const picture = Buffer.from(data, 'base64')
      const name = takes > 1 ? `${id}-${String(take).padStart(2, '0')}.webp` : `${id}.webp`
      const heroName = portrait ? 'hero-portrait.webp' : 'hero.webp'
      await writeFile(hero && takes === 1 ? join(thumbs, '..', heroName) : join(out, name), picture)
      if (takes > 1) await sleep(250)
    }
    console.log(`${id}  ${takes > 1 ? `${takes} takes` : ''}  ${((Date.now() - started) / 1000).toFixed(1)}s`)
  }

  if (takes > 1) console.log(out)
} finally {
  socket?.close()
  chrome.kill()
  // The profile is only removable once Chrome has let go of it. A Chrome that
  // never answered may be gone already, and then 'exit' has been and gone and
  // waiting for it would never return.
  if (chrome.exitCode === null && chrome.signalCode === null) {
    await new Promise((resolve) => chrome.once('exit', resolve))
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
