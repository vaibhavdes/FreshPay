import { closeRing, type LngLat } from '../engine/geo';
import type { GeoCheck } from '../engine/eudr';

const GFW_QUERY_URL = 'https://data-api.globalforestwatch.org/dataset/umd_tree_cover_loss/latest/query/json';

// UMD/Hansen loss on land that had at least 30% tree cover in 2000, the usual forest definition.
const LOSS_SINCE_2021_SQL =
  'SELECT SUM(area__ha) FROM results WHERE umd_tree_cover_loss__year >= 2021 AND umd_tree_cover_density_2000__threshold >= 30';

// `latest` redirects to a versioned URL; follow it by hand so the API key goes with every hop.
async function postWithRedirects(url: string, init: RequestInit, hops = 3): Promise<Response> {
  const res = await fetch(url, { ...init, redirect: 'manual' });
  const location = res.headers.get('location');
  if (res.status >= 300 && res.status < 400 && location) {
    if (hops === 0) throw new Error(`GFW redirected too many times from ${url}`);
    return postWithRedirects(new URL(location, url).toString(), init, hops - 1);
  }
  return res;
}

export async function queryTreeCoverLoss(sql: string, ring: readonly LngLat[], apiKey: string): Promise<Record<string, number | null>[]> {
  const res = await postWithRedirects(GFW_QUERY_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, geometry: { type: 'Polygon', coordinates: [closeRing(ring)] } }),
  });
  if (!res.ok) throw new Error(`GFW ${res.status} on ${res.url}: ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()) as { data?: Record<string, number | null>[] }).data ?? [];
}

export async function fetchTreeCoverLoss(ring: readonly LngLat[], apiKey: string): Promise<GeoCheck> {
  const data = await queryTreeCoverLoss(LOSS_SINCE_2021_SQL, ring, apiKey);
  const lossHa = Object.values(data[0] ?? {}).find((v) => typeof v === 'number') ?? 0;
  return {
    lossSince2021Ha: Math.round(lossHa * 1000) / 1000,
    source: 'Global Forest Watch, UMD tree cover loss (>=30% canopy)',
    fetchedAt: new Date().toISOString(),
  };
}
