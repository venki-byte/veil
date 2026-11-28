import { describe, expect, it } from 'vitest'
import { bandRanges, planBands, rowInk, stretchContrast, toGray } from './imageBands'

/** A page: light paper with dark "text" rows at the given row numbers. */
function page(width: number, height: number, textRows: number[], paper = 200, ink = 40): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(width * height).fill(paper)
  for (const row of textRows) for (let x = 5; x < width - 5; x += 1) gray[row * width + x] = ink
  return gray
}

describe('toGray', () => {
  it('weights green most and ignores alpha', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255])
    expect(Array.from(toGray(rgba, 3, 1))).toEqual([76, 150, 29])
  })
})

describe('stretchContrast', () => {
  it('spreads a dim, low-contrast image over the full range', () => {
    const gray = new Uint8ClampedArray(1000)
    for (let index = 0; index < gray.length; index += 1) gray[index] = index % 2 === 0 ? 90 : 130
    stretchContrast(gray)
    expect(Math.min(...gray)).toBe(0)
    expect(Math.max(...gray)).toBe(255)
  })

  it('leaves a flat image alone', () => {
    const gray = new Uint8ClampedArray(500).fill(120)
    stretchContrast(gray)
    expect(new Set(gray)).toEqual(new Set([120]))
  })

  it('keeps the order of brightness', () => {
    const gray = new Uint8ClampedArray([50, 100, 150, 200, 50, 100, 150, 200])
    stretchContrast(gray)
    expect(gray[0]).toBeLessThan(gray[1])
    expect(gray[1]).toBeLessThan(gray[2])
    expect(gray[2]).toBeLessThan(gray[3])
  })
})

describe('rowInk', () => {
  it('measures the dark share of each row', () => {
    const ink = rowInk(page(100, 10, [3]), 100, 10)
    expect(ink[3]).toBeCloseTo(0.9, 1)
    expect(ink[0]).toBe(0)
  })
})

describe('bandRanges', () => {
  it('uses clean cuts as they are when the page has a blank gap', () => {
    const textRows: number[] = []
    for (let row = 560; row < 760; row += 1) if (row < 668 || row > 676) textRows.push(row)
    const ink = rowInk(page(960, 1280, textRows), 960, 1280)
    const [first, second] = bandRanges(ink, 960, 1280)
    expect(first.bottom).toBe(second.top)
  })

  it('overlaps the bands when text runs across every row, as on a tilted photo', () => {
    // Ink on every row near the middle: any cut would slice through a line.
    const rows = Array.from({ length: 1280 }, (_, row) => row)
    const ink = rowInk(page(960, 1280, rows), 960, 1280)
    const [first, second] = bandRanges(ink, 960, 1280)
    expect(first.bottom).toBeGreaterThan(second.top)
    expect(first.top).toBe(0)
    expect(second.bottom).toBe(1280)
    // Together the bands still cover the whole page.
    expect(first.top).toBe(0)
    expect(second.top).toBeLessThan(first.bottom)
  })

  it('returns one range for a page that is read whole', () => {
    expect(bandRanges(new Array(500).fill(0), 900, 500)).toEqual([{ top: 0, bottom: 500 }])
  })
})

describe('planBands', () => {
  it('reads a short or wide photo whole', () => {
    expect(planBands(new Array(500).fill(0), 900, 500)).toEqual([0, 500])
    expect(planBands(new Array(600).fill(0), 1000, 600)).toEqual([0, 600])
  })

  it('splits a tall A4-shaped page in two, with every band at most as tall as 0.8 of the width', () => {
    const bounds = planBands(new Array(1280).fill(0), 960, 1280)
    expect(bounds).toHaveLength(3)
    expect(bounds[0]).toBe(0)
    expect(bounds[2]).toBe(1280)
  })

  it('cuts in the blank gap, not through a line of text', () => {
    const height = 1280
    // Text on every row around the middle, except a gap at rows 668 to 676.
    const textRows: number[] = []
    for (let row = 560; row < 760; row += 1) if (row < 668 || row > 676) textRows.push(row)
    const ink = rowInk(page(960, height, textRows), 960, height)
    const [, cut] = planBands(ink, 960, height)
    expect(cut).toBeGreaterThanOrEqual(668)
    expect(cut).toBeLessThanOrEqual(676)
  })

  it('uses more bands for a very tall page, never more than the cap', () => {
    expect(planBands(new Array(3000).fill(0), 1000, 3000)).toHaveLength(5)
    expect(planBands(new Array(9000).fill(0), 1000, 9000)).toHaveLength(5)
  })

  it('returns increasing boundaries', () => {
    const bounds = planBands(new Array(2400).fill(0.5), 1000, 2400)
    for (let index = 1; index < bounds.length; index += 1) expect(bounds[index]).toBeGreaterThan(bounds[index - 1])
  })
})
