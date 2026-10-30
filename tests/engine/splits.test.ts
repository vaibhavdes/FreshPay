import { describe, expect, it } from 'vitest';
import { allocate } from '@/lib/engine/splits';

const sum = (parts: { cents: number }[]) => parts.reduce((total, p) => total + p.cents, 0);

describe('allocate', () => {
  it('gives leftover cents to the largest remainders so the total is exact', () => {
    expect(allocate(1000, [{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }, { id: 'c', weight: 1 }])).toEqual([
      { id: 'a', cents: 334 },
      { id: 'b', cents: 333 },
      { id: 'c', cents: 333 },
    ]);
  });

  it('splits an input tranche between dealer and farmer', () => {
    const parts = allocate(12_345, [{ id: 'dealer', weight: 6000 }, { id: 'farmer', weight: 4000 }]);
    expect(parts).toEqual([
      { id: 'dealer', cents: 7407 },
      { id: 'farmer', cents: 4938 },
    ]);
  });

  it('prefers the larger remainder over input order', () => {
    expect(allocate(10, [{ id: 'a', weight: 1 }, { id: 'b', weight: 2 }])).toEqual([
      { id: 'a', cents: 3 },
      { id: 'b', cents: 7 },
    ]);
  });

  it('always sums to the tranche for pro-rata weights', () => {
    const weights = [4120, 3377, 2890, 1999, 731, 512];
    for (let total = 0; total < 5000; total += 37) {
      const parts = allocate(total, weights.map((weight, i) => ({ id: `farmer-${i}`, weight })));
      expect(sum(parts)).toBe(total);
    }
  });

  it('gives nothing to a zero-weight share', () => {
    expect(allocate(500, [{ id: 'a', weight: 0 }, { id: 'b', weight: 1 }])).toEqual([
      { id: 'a', cents: 0 },
      { id: 'b', cents: 500 },
    ]);
  });

  it.each([
    ['a negative amount', -1, [{ id: 'a', weight: 1 }]],
    ['a fractional amount', 10.5, [{ id: 'a', weight: 1 }]],
    ['no shares', 10, []],
    ['duplicate ids', 10, [{ id: 'a', weight: 1 }, { id: 'a', weight: 1 }]],
    ['a fractional weight', 10, [{ id: 'a', weight: 0.5 }]],
    ['a negative weight', 10, [{ id: 'a', weight: -1 }]],
    ['zero total weight', 10, [{ id: 'a', weight: 0 }]],
    ['an amount that overflows', Number.MAX_SAFE_INTEGER, [{ id: 'a', weight: 3 }]],
  ])('rejects %s', (_, total, shares) => {
    expect(() => allocate(total, shares)).toThrow(RangeError);
  });
});
