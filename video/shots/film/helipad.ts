/**
 * A rooftop helipad marking: a white ring and a white H on the roof's own
 * colour, which is what such a marking is — paint on a roof, not a sign.
 */
export function helipad(): HTMLCanvasElement {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ink = canvas.getContext('2d')
  if (!ink) return canvas
  const middle = size / 2
  ink.strokeStyle = '#ffffff'
  ink.lineWidth = size * 0.06
  ink.beginPath()
  ink.arc(middle, middle, size * 0.43, 0, Math.PI * 2)
  ink.stroke()
  // The H drawn as three bars rather than a letter, so no font decides its shape
  ink.fillStyle = '#ffffff'
  const tallH = size * 0.46
  const wideH = size * 0.32
  const bar = size * 0.075
  ink.fillRect(middle - wideH / 2, middle - tallH / 2, bar, tallH)
  ink.fillRect(middle + wideH / 2 - bar, middle - tallH / 2, bar, tallH)
  ink.fillRect(middle - wideH / 2, middle - bar / 2, wideH, bar)
  return canvas
}
