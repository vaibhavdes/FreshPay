import { describe, expect, it } from 'vitest';
import { balanceDueCents, balancePayouts, captureForDelivery } from '@/lib/engine/settlement';

const plots = [
  { farmerId: 'lakshmi', valueCents: 571_600, eudrStatus: 'PASS' as const },
  { farmerId: 'ravi', valueCents: 954_400, eudrStatus: 'PASS' as const },
  { farmerId: 'savitha', valueCents: 385_700, eudrStatus: 'FAIL' as const },
];

describe('balanceDueCents', () => {
  it('owes the compliant value minus the advance, never less than zero', () => {
    expect(balanceDueCents(plots, 764_700)).toBe(571_600 + 954_400 - 764_700);
    expect(balanceDueCents(plots, 2_000_000)).toBe(0);
  });
});

describe('captureForDelivery', () => {
  it('captures the accepted weight at the accepted quality and voids the rest', () => {
    expect(captureForDelivery(761_300, { deliveredKg: 2_000, acceptedKg: 1_840, qualityPercent: 100 })).toEqual({ captureCents: 700_396, voidCents: 60_904 });
    expect(captureForDelivery(100_000, { deliveredKg: 1_000, acceptedKg: 1_000, qualityPercent: 95 })).toEqual({ captureCents: 95_000, voidCents: 5_000 });
  });

  it('voids everything when QC rejects the lot', () => {
    expect(captureForDelivery(100_000, { deliveredKg: 1_000, acceptedKg: 0, qualityPercent: 100 })).toEqual({ captureCents: 0, voidCents: 100_000 });
  });

  it.each([
    ['a negative authorization', -1, { deliveredKg: 1, acceptedKg: 1, qualityPercent: 100 }],
    ['nothing delivered', 100, { deliveredKg: 0, acceptedKg: 0, qualityPercent: 100 }],
    ['more accepted than delivered', 100, { deliveredKg: 10, acceptedKg: 11, qualityPercent: 100 }],
    ['a fractional weight', 100, { deliveredKg: 10, acceptedKg: 9.5, qualityPercent: 100 }],
    ['quality above 100', 100, { deliveredKg: 10, acceptedKg: 10, qualityPercent: 101 }],
  ])('rejects %s', (_, authorized, qc) => {
    expect(() => captureForDelivery(authorized, qc)).toThrow(RangeError);
  });
});

describe('balancePayouts', () => {
  it('pays compliant farmers in proportion to plot value, exactly', () => {
    const payouts = balancePayouts(700_396, plots);
    expect(payouts.map((p) => p.id)).toEqual(['lakshmi', 'ravi']);
    expect(payouts.reduce((sum, p) => sum + p.cents, 0)).toBe(700_396);
  });

  it('adds up several plots of one farmer', () => {
    expect(balancePayouts(300, [
      { farmerId: 'lakshmi', valueCents: 100, eudrStatus: 'PASS' },
      { farmerId: 'lakshmi', valueCents: 100, eudrStatus: 'PASS' },
      { farmerId: 'ravi', valueCents: 100, eudrStatus: 'PASS' },
    ])).toEqual([
      { id: 'lakshmi', cents: 200 },
      { id: 'ravi', cents: 100 },
    ]);
  });

  it('refuses when no plot is compliant', () => {
    expect(() => balancePayouts(100, [plots[2]])).toThrow('No compliant plot');
  });
});
