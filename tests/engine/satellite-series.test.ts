import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { satelliteSignal, type MonthlyView } from '@/lib/engine/satellite';
import { PLOT_MILESTONES } from '@/lib/engine/stateMachine';

// Real monthly Sentinel-2 NDVI, Dec 2025 to Oct 2026, over the season's three farms in Kodagu: two
// coffee plantations mapped on OpenStreetMap and one outline over forest cleared in 2023-24.
// Fetched from the Copernicus Data Space (contains modified Copernicus Sentinel data 2025-2026).
type Series = { commodity: string; views: MonthlyView[] };
const series = JSON.parse(readFileSync('tests/fixtures/sentinel2-series.json', 'utf8')) as Record<string, Series>;

// What the satellite check would have said to a claim sent at the end of each month.
const monthByMonth = ({ commodity, views }: Series) =>
  views.map((_, i) => ({ month: views[i].month, signal: satelliteSignal(commodity, PLOT_MILESTONES[1 + (i % 4)], views.slice(0, i + 1)) }));

describe('satellite check over a real year, month by month', () => {
  it('never questions the two mapped coffee plantations, monsoon included', () => {
    for (const farm of ['plot-lakshmi', 'plot-ravi']) {
      const run = monthByMonth(series[farm]);
      expect(run.filter((r) => r.signal.status === 'WARN'), farm).toEqual([]);
      expect(run.find((r) => r.month === '2026-06')!.signal.status, farm).toBe('PASS');
    }
  });

  it('skips the months the farm was under cloud and judges by the clear ones', () => {
    const { commodity, views } = series['plot-ravi'];
    expect(views.filter((v) => v.ndvi === null).map((v) => v.month)).toEqual(['2026-06', '2026-07']);
    expect(satelliteSignal(commodity, 'CROP_CARE', views.slice(0, views.findIndex((v) => v.month === '2026-07') + 1)).status).toBe('PASS');
  });

  it('flags the month after the same canopy is cut back', () => {
    const { commodity, views } = series['plot-lakshmi'];
    const cleared = [...views, { month: '2026-11', ndvi: 0.42, clearShare: 1 }];
    expect(satelliteSignal(commodity, 'HARVEST', cleared)).toMatchObject({ status: 'WARN', detail: expect.stringContaining('possible clearing') });
  });
});
