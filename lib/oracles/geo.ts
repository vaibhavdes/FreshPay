import { closeRing, type LngLat } from '../engine/geo';
import type { GeoCheck } from '../engine/eudr';

const GFW_QUERY_URL = 'https://data-api.globalforestwatch.org/dataset/umd_tree_cover_loss/latest/query/json';

// UMD/Hansen loss on land that had at least 30% tree cover in 2000, the usual forest definition.
const LOSS_SINCE_2021_SQL =
  'SELECT SUM(area__ha) FROM results WHERE umd_tree_cover_loss__year >= 2021 AND umd_tree_cover_density_2000__threshold >= 30';

export async function fetchTreeCoverLoss(ring: readonly LngLat[], apiKey: string): Promise<GeoCheck> {
  const res = await fetch(GFW_QUERY_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: LOSS_SINCE_2021_SQL, geometry: { type: 'Polygon', coordinates: [closeRing(ring)] } }),
  });
  if (!res.ok) throw new Error(`GFW ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const { data } = (await res.json()) as { data?: Record<string, number | null>[] };
  const lossHa = Object.values(data?.[0] ?? {}).find((v) => typeof v === 'number') ?? 0;
  return {
    lossSince2021Ha: Math.round(lossHa * 1000) / 1000,
    source: 'Global Forest Watch, UMD tree cover loss (>=30% canopy)',
    fetchedAt: new Date().toISOString(),
  };
}
