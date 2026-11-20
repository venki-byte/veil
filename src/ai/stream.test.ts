import { describe, expect, it } from 'vitest'
import { accumulate } from './stream'

const join = (pieces: string[]) => pieces.reduce(accumulate, '')

describe('accumulate', () => {
  it('appends pieces that are deltas', () => {
    expect(join(['The haemo', 'globin is ', '10.8 g/dL.'])).toBe('The haemoglobin is 10.8 g/dL.')
  })

  it('takes pieces that are the whole answer so far', () => {
    expect(join(['The haemo', 'The haemoglobin is ', 'The haemoglobin is 10.8 g/dL.'])).toBe('The haemoglobin is 10.8 g/dL.')
  })

  it('ignores empty pieces', () => {
    expect(join(['', 'Hello', '', ' there'])).toBe('Hello there')
  })

  it('keeps placeholders that arrive split across pieces', () => {
    expect(join(['Ask [PERS', 'ON_1] about', ' it.'])).toBe('Ask [PERSON_1] about it.')
  })

  it('does not mistake a repeated short word for the whole answer', () => {
    expect(join(['no', ' no', 'no'])).toBe('no nono')
  })
})
