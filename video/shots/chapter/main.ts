/**
 * The card before each part: its number coming up, a line drawn under it, its
 * name, and then the whole card swept off to the left for the part to begin.
 * Chosen by `?n=`, worded below.
 */
import { inOut, out, shot, span } from '../../shared/shot.js'

const PARTS: Record<string, { readonly title: string; readonly sub: string }> = {
  '01': { title: 'ひとつの建物で', sub: '色も、形も、動きも、光も、コードで。' },
  '02': { title: 'あなたのページで', sub: 'PLATEAU を、あなたのページに。アイデアの土台に。' },
  '03': { title: 'しくみ', sub: 'three.js の上で、国のオープンデータだけで。' },
}
const SECONDS = 2.2

const n = new URLSearchParams(location.search).get('n') ?? '01'
const part = PARTS[n]!
const card = document.getElementById('card')!
const number = document.getElementById('number')!
const rule = document.getElementById('rule')!
const title = document.getElementById('title')!
const sub = document.getElementById('sub')!
number.textContent = n
title.textContent = part.title
sub.textContent = part.sub

shot(SECONDS, document.fonts.ready, (t) => {
  const up = span(t, 0.05, 0.5, out)
  number.style.transform = `translateY(${(1 - up) * 40}px)`
  number.style.opacity = String(up)
  rule.style.width = `${span(t, 0.3, 0.8, inOut) * 120}px`
  const words = span(t, 0.5, 0.9, out)
  title.style.opacity = String(words)
  title.style.transform = `translateX(${(1 - words) * -16}px)`
  sub.style.opacity = String(span(t, 0.7, 1.1, out))
  // Swept off to the left at the end
  const away = span(t, SECONDS - 0.45, SECONDS, inOut)
  card.style.transform = `translateX(${-away * 1500}px)`
})
