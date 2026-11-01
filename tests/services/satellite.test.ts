import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import type { LngLat } from '@/lib/engine/geo';
import { picturesToTake, refreshSatellite, viewPicture, viewsOf } from '@/lib/services/satellite';
import { freshDb, NOW } from '../helpers';

const RING: LngLat[] = [
  [75.64, 13.275],
  [75.641, 13.275],
  [75.641, 13.276],
  [75.64, 13.276],
];
const CREDENTIALS = { clientId: 'client', clientSecret: 'secret' };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

let db: Db;
let requests: { url: string; body: unknown }[];

const month = (i: number) => {
  const d = new Date(Date.UTC(2025, 11 + i, 1));
  return d.toISOString().slice(0, 10);
};

beforeEach(async () => {
  db = await freshDb();
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('openid-connect/token')) return Response.json({ access_token: 'cdse-token', expires_in: 600 });
      requests.push({ url, body: JSON.parse(String(init.body)) });
      if (url.endsWith('/statistics')) {
        return Response.json({
          data: Array.from({ length: 12 }, (_, i) => ({
            interval: { from: `${month(i)}T00:00:00Z` },
            outputs: { ndvi: { bands: { B0: { stats: i >= 6 && i <= 8 ? { mean: 'NaN', sampleCount: 400, noDataCount: 400 } : { mean: 0.7 + i / 100, sampleCount: 400, noDataCount: 40 } } } } },
          })),
        });
      }
      return new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('refreshSatellite', () => {
  it('stores a year of cloud-masked NDVI and pictures of the clearest months', async () => {
    const views = await refreshSatellite(db, RING, CREDENTIALS, NOW);

    const stats = requests.find((r) => r.url.endsWith('/statistics'))!.body as { aggregation: { aggregationInterval: { of: string } }; input: { bounds: { geometry: { coordinates: LngLat[][] } } } };
    expect(stats.aggregation.aggregationInterval.of).toBe('P1M');
    expect(stats.input.bounds.geometry.coordinates[0]).toHaveLength(5);

    expect(views).toHaveLength(12);
    expect(views[0]).toMatchObject({ month: '2025-12', ndvi: 0.7, clearShare: 1 });
    expect(views[7]).toMatchObject({ ndvi: null, clearShare: 0 });
    expect(views.filter((v) => v.hasPicture).map((v) => v.month)).toEqual(['2025-12', '2026-03', '2026-09']);
    expect(await viewPicture(db, RING, views.find((v) => v.hasPicture)!.month)).toEqual(Buffer.from(PNG));
  });

  it('does not call Copernicus again while the current month is fresh', async () => {
    await refreshSatellite(db, RING, CREDENTIALS, NOW);
    const before = requests.length;
    await refreshSatellite(db, RING, CREDENTIALS, NOW + 60_000);
    expect(requests.length).toBe(before);
    expect(await viewsOf(db, RING)).toHaveLength(12);
  });
});

describe('picturesToTake', () => {
  it('picks the clearest month in each quarter, skipping cloudy ones', () => {
    const views = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, ndvi: i >= 6 && i <= 8 ? null : 0.7, clearShare: i === 1 ? 0.95 : i >= 6 && i <= 8 ? 0 : 0.8 }));
    expect(picturesToTake(views)).toEqual(['2026-10', '2026-04', '2026-02']);
  });
});
