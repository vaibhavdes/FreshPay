import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { satelliteSignal, type MonthlyView } from '@/lib/engine/satellite';
import { PLOT_MILESTONES } from '@/lib/engine/stateMachine';

// Real monthly Sentinel-2 NDVI for two demo farms in Chikkamagaluru, Dec 2025 to Oct 2026, fetched
// from the Copernicus Data Space (Contains modified Copernicus Sentinel data 2025-2026).
const series = JSON.parse(readFileSync('tests/fixtures/sentinel2-series.json', 'utf8')) as Record<string, { commodity: string; views: MonthlyView[] }>;

// What the satellite check would have said to a claim sent at the end of each month.
const monthByMonth = ({ commodity, views }: { commodity: string; views: MonthlyView[] }) =>
  views.map((_, i) => ({ month: views[i].month, signal: satelliteSignal(commodity, PLOT_MILESTONES[1 + (i % 4)], views.slice(0, i + 1)) }));

describe('satellite check over a real year, month by month', () => {
  it("never questions Lakshmi's shaded coffee, through the monsoon too", () => {
    const run = monthByMonth(series['plot-elekhan']);
    expect(run.filter((r) => r.signal.status === 'WARN')).toEqual([]);
    expect(run.find((r) => r.month === '2026-07')!.signal.status).toBe('PASS');
  });

  it('skips the monsoon months the farm was under cloud and judges by the clear ones', () => {
    const { commodity, views } = series['plot-hirebyle'];
    const cloudy = views.filter((v) => v.ndvi === null).map((v) => v.month);
    expect(cloudy).toEqual(['2026-07', '2026-08']);
    expect(satelliteSignal(commodity, 'CROP_CARE', views.slice(0, views.findIndex((v) => v.month === '2026-08') + 1)).status).toBe('PASS');
  });

  it('flags the month after the same canopy is cut back', () => {
    const { commodity, views } = series['plot-elekhan'];
    const cleared = [...views, { month: '2026-11', ndvi: 0.42, clearShare: 1 }];
    expect(satelliteSignal(commodity, 'HARVEST', cleared)).toMatchObject({ status: 'WARN', detail: expect.stringContaining('possible clearing') });
  });
});
