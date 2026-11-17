/** Checking the lengths an option is given in — metres, or pixels for a line — or a RangeError naming the option. */

/** A length that has to be more than nothing, or a RangeError saying which. */
export function positiveMetres(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number of metres, not ${value}`)
  }
  return value
}

/** A length that may be nothing but not less, or a RangeError saying which. */
export function metres(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a number of metres, not ${value}`)
  }
  return value
}

/**
 * A width a line is drawn at, in pixels of the page, that has to be more than
 * nothing, or a RangeError saying which. A line is turned off with its own
 * switch, so nought here is a mistake and not a way to say so.
 */
export function pixels(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number of pixels, not ${value}`)
  }
  return value
}
