import { describe, it, expect } from 'vitest';
import { iso31000Band, type Iso31000Band } from './iso31000Band';

describe('iso31000Band — ISO 31000:2018 4-band calibration', () => {
  it('low at the bottom and its boundary (score ≤ 4)', () => {
    expect(iso31000Band(1, 1)).toBe('low'); // 1
    expect(iso31000Band(2, 2)).toBe('low'); // 4 (boundary)
  });
  it('medium between 5 and 9 inclusive', () => {
    expect(iso31000Band(1, 5)).toBe('medium'); // 5
    expect(iso31000Band(3, 3)).toBe('medium'); // 9 (boundary)
  });
  it('high between 10 and 15 inclusive', () => {
    expect(iso31000Band(2, 5)).toBe('high'); // 10
    expect(iso31000Band(3, 5)).toBe('high'); // 15 (boundary)
  });
  it('extreme at 16 and above', () => {
    expect(iso31000Band(4, 4)).toBe('extreme'); // 16
    expect(iso31000Band(5, 5)).toBe('extreme'); // 25
  });

  it('returns one of the four ISO bands for every 5×5 cell', () => {
    const valid: Iso31000Band[] = ['low', 'medium', 'high', 'extreme'];
    for (let p = 1; p <= 5; p++) {
      for (let i = 1; i <= 5; i++) {
        expect(valid).toContain(iso31000Band(p, i));
      }
    }
  });
});
