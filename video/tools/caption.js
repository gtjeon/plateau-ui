/**
 * Words laid over a page the video did not make (a site example): what the
 * idea is, the API it stands on, and the line of the catchphrase the part is
 * about. Given by the recorder as `window.__arg = { say, api, phrase, seconds }`.
 *
 * Fades on the page's own clock, which the recorder turns, so it comes in and
 * goes out at the same frames however long they take to capture.
 */
;(() => {
  const { say, api, phrase, seconds, corner = 'left' } = window.__arg
  const box = document.createElement('div')
  box.style.cssText = `
    position: fixed; ${corner}: 40px; bottom: 84px; z-index: 2147483000;
    padding: 16px 20px 18px; border-radius: 14px;
    background: rgba(255, 255, 255, 0.95); box-shadow: 0 6px 24px rgba(20, 30, 45, 0.18);
    font-family: 'Hiragino Sans', 'Noto Sans JP', system-ui, sans-serif; color: #1f2933;
    opacity: 0; pointer-events: none;`
  const line = document.createElement('div')
  line.textContent = say
  line.style.cssText = 'font-weight: 700; font-size: 22px; letter-spacing: 0.03em;'
  const code = document.createElement('code')
  code.textContent = api
  code.style.cssText = `display: block; margin-top: 10px; padding: 8px 12px; border-radius: 8px;
    background: #1f2933; color: #e9eef5; font-family: 'SF Mono', Menlo, monospace; font-size: 16px; white-space: pre;`
  box.append(line, code)

  const pill = document.createElement('div')
  pill.textContent = phrase
  pill.style.cssText = `
    position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 2147483000;
    padding: 10px 22px; border-radius: 999px; background: rgba(20, 26, 34, 0.86); color: #fff;
    font-family: 'Hiragino Sans', 'Noto Sans JP', system-ui, sans-serif; font-weight: 600; font-size: 22px;
    letter-spacing: 0.05em; white-space: nowrap; opacity: 0; pointer-events: none;`
  document.body.append(box, pill)

  let start = null
  const fade = 0.4
  const tick = () => {
    const now = performance.now() / 1000
    start ??= now
    const t = now - start
    const o = Math.max(0, Math.min(1, t / fade, (seconds - t) / fade))
    box.style.opacity = String(Math.max(0, Math.min(1, (t - 0.3) / fade, (seconds - 0.2 - t) / fade)))
    pill.style.opacity = String(o)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})()
