import { describe, expect, it } from 'vitest';
import { accruePremium } from '@/lib/engine/premium';

describe('accruePremium', () => {
  it('accrues the per-plot premium while the mandate has room', () => {
    expect(accruePremium({ perPlotCents: 4000, capCents: 12_000, accruedCents: 8000 })).toEqual({ kind: 'ACCRUE', cents: 4000 });
  });

  it('skips once the next premium would pass the cap', () => {
    expect(accruePremium({ perPlotCents: 4000, capCents: 12_000, accruedCents: 8001 })).toEqual({ kind: 'SKIP', reason: 'MANDATE_EXCEEDED' });
  });

  it('skips without a mandate', () => {
    expect(accruePremium(null)).toEqual({ kind: 'SKIP', reason: 'NO_MANDATE' });
    expect(accruePremium({ perPlotCents: 0, capCents: 10, accruedCents: 0 })).toEqual({ kind: 'SKIP', reason: 'NO_MANDATE' });
  });
});
