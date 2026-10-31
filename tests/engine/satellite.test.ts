import { describe, expect, it } from 'vitest';
import { satelliteSignal, type MonthlyView } from '@/lib/engine/satellite';

const year = (ndvi: (number | null)[], clearShare = 0.9): MonthlyView[] =>
  ndvi.map((n, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, ndvi: n, clearShare: n === null ? 0 : clearShare }));

describe('satelliteSignal', () => {
  it('supports a coffee farm whose canopy stays green', () => {
    expect(satelliteSignal('coffee', 'INPUTS', year([0.71, 0.7, 0.68, 0.66, null, null, null, 0.72, 0.73, 0.7]))).toMatchObject({ status: 'PASS' });
  });

  it('warns when a tree crop canopy falls sharply or is missing', () => {
    expect(satelliteSignal('coffee', 'INPUTS', year([0.72, 0.71, 0.7, 0.69, 0.7, 0.71, 0.45]))).toMatchObject({ status: 'WARN', detail: expect.stringContaining('possible clearing') });
    expect(satelliteSignal('cocoa', 'PLOT_VERIFIED', year([0.25, 0.22, 0.2]))).toMatchObject({ status: 'WARN', detail: expect.stringContaining('Little green cover') });
  });

  it('expects a field crop to have grown by crop care and harvest, but not at sowing', () => {
    expect(satelliteSignal('potato', 'INPUTS', year([0.18, 0.2, 0.22])).status).toBe('PASS');
    expect(satelliteSignal('potato', 'HARVEST', year([0.18, 0.45, 0.78, 0.66, 0.3])).status).toBe('PASS');
    expect(satelliteSignal('potato', 'HARVEST', year([0.18, 0.2, 0.22, 0.25])).status).toBe('WARN');
  });

  it('says nothing when clouds hid the farm in recent months', () => {
    expect(satelliteSignal('coffee', 'INPUTS', year([0.7, 0.7, null, null, null]))).toMatchObject({ status: 'UNKNOWN', detail: 'Clouds hid the farm in recent months.' });
    expect(satelliteSignal('coffee', 'INPUTS', year([0.7, 0.7, 0.7], 0.1))).toMatchObject({ status: 'UNKNOWN', detail: 'No clear satellite view of the farm yet.' });
    expect(satelliteSignal('coffee', 'INPUTS', [])).toMatchObject({ status: 'UNKNOWN' });
  });
});
