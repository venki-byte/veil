/**
 * Pure image maths for photographed documents. No canvas and no browser here,
 * so it is unit-tested with small synthetic images.
 *
 * Two problems make Gemini Nano misread photos:
 *   1. Low contrast (dim light, tinted lamps), which blurs thin text.
 *   2. A whole page in one image: the model scales it down, so small print is lost.
 *
 * The fixes are general. Contrast is stretched using the image's own
 * brightness range, and a tall page is cut into a few bands at blank rows so
 * each band keeps more pixels per character and no line of text is cut.
 */

/** Grayscale from RGBA pixel data, one byte per pixel. */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(width * height)
  for (let index = 0, pixel = 0; index < gray.length; index += 1, pixel += 4) {
    gray[index] = Math.round(0.299 * rgba[pixel] + 0.587 * rgba[pixel + 1] + 0.114 * rgba[pixel + 2])
  }
  return gray
}

/**
 * Stretches brightness so the darkest 1% maps to 0 and the lightest 1% to
 * 255. Works in place. An image with almost no range is left alone, so a
 * blank or flat picture is not turned into noise.
 */
export function stretchContrast(gray: Uint8ClampedArray): { low: number; high: number } {
  const histogram = new Array<number>(256).fill(0)
  for (const value of gray) histogram[value] += 1

  const cut = gray.length * 0.01
  let low = 0
  let seen = 0
  while (low < 255 && seen + histogram[low] <= cut) {
    seen += histogram[low]
    low += 1
  }
  let high = 255
  seen = 0
  while (high > 0 && seen + histogram[high] <= cut) {
    seen += histogram[high]
    high -= 1
  }

  if (high - low < 24) return { low, high }
  const scale = 255 / (high - low)
  for (let index = 0; index < gray.length; index += 1) {
    gray[index] = Math.max(0, Math.min(255, Math.round((gray[index] - low) * scale)))
  }
  return { low, high }
}

/** Share of dark pixels in each row. Text and lines are dark; paper and margins are not. */
export function rowInk(gray: Uint8ClampedArray, width: number, height: number, darkBelow = 110): number[] {
  const ink = new Array<number>(height).fill(0)
  for (let y = 0; y < height; y += 1) {
    let dark = 0
    const base = y * width
    for (let x = 0; x < width; x += 1) if (gray[base + x] < darkBelow) dark += 1
    ink[y] = dark / width
  }
  return ink
}

/** Tallest a band may be, as a share of the page width. */
const MAX_BAND_ASPECT = 0.8
/** Pages shorter than this are read whole. */
const MIN_HEIGHT_TO_SPLIT = 700
export const MAX_BANDS = 4

/**
 * Chooses where to cut a page into horizontal bands. Returns the row numbers
 * of every boundary, including 0 and the page height, so n bands give n + 1
 * numbers. Each cut is the row with the least ink within 20% of the ideal
 * even split, so cuts land in the gaps between lines of text. Cuts are never
 * made through a line unless the page has no gap there at all.
 */
export function planBands(ink: number[], width: number, height: number, maxBands = MAX_BANDS): number[] {
  const bandCount = height < MIN_HEIGHT_TO_SPLIT ? 1 : Math.min(maxBands, Math.max(1, Math.ceil(height / width / MAX_BAND_ASPECT)))
  const bounds = [0]
  const slice = height / bandCount
  for (let part = 1; part < bandCount; part += 1) {
    const ideal = Math.round(part * slice)
    const reach = Math.round(slice * 0.2)
    let best = ideal
    let bestInk = Infinity
    for (let y = Math.max(bounds[bounds.length - 1] + 1, ideal - reach); y <= Math.min(height - 1, ideal + reach); y += 1) {
      // Prefer the quietest row; among equally quiet rows, the one nearest the ideal cut.
      const cost = ink[y] + Math.abs(y - ideal) * 1e-6
      if (cost < bestInk) {
        bestInk = cost
        best = y
      }
    }
    bounds.push(best)
  }
  bounds.push(height)
  return bounds
}
