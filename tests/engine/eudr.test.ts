import { describe, expect, it } from 'vitest';
import { buildEudrRecord, eudrStatus } from '@/lib/engine/eudr';

const check = (lossSince2021Ha: number) => ({ lossSince2021Ha, source: 'GFW umd_tree_cover_loss', fetchedAt: '2026-10-30T10:00:00Z' });

describe('eudrStatus', () => {
  it('passes a plot with no forest loss since 2021', () => {
    expect(eudrStatus(check(0))).toBe('PASS');
  });

  it('sends edge-noise amounts of loss to review', () => {
    expect(eudrStatus(check(0.08))).toBe('REVIEW');
  });

  it('fails a plot with real loss after the cutoff', () => {
    expect(eudrStatus(check(0.6))).toBe('FAIL');
  });

  it('reviews a plot that has not been checked yet', () => {
    expect(eudrStatus(null)).toBe('REVIEW');
  });
});

describe('buildEudrRecord', () => {
  const input = {
    plot: {
      id: 'plot-1',
      name: 'Hill plot 1',
      ring: [
        [75.77, 13.32],
        [75.772, 13.32],
        [75.772, 13.322],
        [75.77, 13.322],
      ] as const,
      areaHa: 4.8137,
      country: 'IN',
      commodity: 'coffee',
    },
    producer: { name: 'Lakshmi', cooperative: 'Baba Budangiri FPO' },
    operator: { name: 'EU Roaster', country: 'DE' },
    check: check(0),
    evidence: [{ milestone: 'PLOT_VERIFIED', sha256: 'a'.repeat(64), verifiedAt: '2026-11-03T06:00:00Z' }],
    payments: [{ milestone: 'PLOT_VERIFIED', paypalId: 'BATCH-1', cents: 2500 }],
    generatedAt: '2026-11-03T06:05:00Z',
  };

  it('produces a closed GeoJSON polygon with the due-diligence fields', () => {
    const record = buildEudrRecord(input);
    expect(record.geometry.coordinates[0]).toHaveLength(5);
    expect(record.properties).toMatchObject({
      hsCode: '0901',
      countryOfProduction: 'IN',
      areaHa: 4.81,
      deforestationCutoff: '2020-12-31',
      treeCoverLossSince2021Ha: 0,
      eudrStatus: 'PASS',
      payments: [{ paypalId: 'BATCH-1' }],
    });
  });

  it('marks an unchecked plot for review and leaves unknown codes empty', () => {
    const record = buildEudrRecord({ ...input, check: null, plot: { ...input.plot, commodity: 'vanilla' } });
    expect(record.properties).toMatchObject({ eudrStatus: 'REVIEW', hsCode: null, treeCoverLossSince2021Ha: null, geoSource: null, geoCheckedAt: null });
  });
});
