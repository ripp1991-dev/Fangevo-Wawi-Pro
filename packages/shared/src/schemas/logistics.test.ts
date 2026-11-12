import { describe, expect, it } from 'vitest';
import { isTrivialPin, pinSchema } from './logistics';

describe('PIN für den Packtisch', () => {
  it('lehnt zu einfache PINs ab', () => {
    for (const p of ['0000', '1111', '1234', '4321', '123456', '987654'])
      expect(isTrivialPin(p)).toBe(true);
    for (const p of ['1991', '2580', '1357', '9012']) expect(isTrivialPin(p)).toBe(false);
  });

  it('erlaubt nur 4 bis 6 Ziffern', () => {
    expect(pinSchema.safeParse('1991').success).toBe(true);
    expect(pinSchema.safeParse('199').success).toBe(false);
    expect(pinSchema.safeParse('1991991').success).toBe(false);
    expect(pinSchema.safeParse('19a1').success).toBe(false);
  });
});
