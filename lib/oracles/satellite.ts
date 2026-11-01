import type { LngLat } from '../engine/geo';
import type { MonthlyView } from '../engine/satellite';

// Sentinel-2 imagery from the Copernicus Data Space Ecosystem (free account, open licence:
// "Contains modified Copernicus Sentinel data"). The Statistical API gives a cloud-masked NDVI
// per month over the farm outline; the Process API gives a true-colour picture of the farm.

const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const API = 'https://sh.dataspace.copernicus.eu/api/v1';
const CRS84 = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84';

export type SatelliteCredentials = { clientId: string; clientSecret: string };

// Scene classes the L2A processor marks as clear ground: vegetation, bare soil, water, unclassified.
const NDVI_SCRIPT = `//VERSION=3
function setup() {
  return { input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }], output: [{ id: "ndvi", bands: 1, sampleType: "FLOAT32" }, { id: "dataMask", bands: 1 }] };
}
function evaluatePixel(s) {
  const clear = [4, 5, 6, 7].includes(s.SCL) ? 1 : 0;
  return { ndvi: [(s.B08 - s.B04) / (s.B08 + s.B04)], dataMask: [s.dataMask * clear] };
}`;

// Square-root tone curve: shaded canopy is dark in raw reflectance, so it is lifted to stay readable.
const TRUE_COLOUR_SCRIPT = `//VERSION=3
function setup() {
  return { input: ["B02", "B03", "B04", "dataMask"], output: { bands: 4 } };
}
function evaluatePixel(s) {
  const tone = (v) => Math.sqrt(Math.max(0, 2.8 * v));
  return [tone(s.B04), tone(s.B03), tone(s.B02), s.dataMask];
}`;

let cached: { token: string; expiresAt: number } | undefined;

async function token({ clientId, clientSecret }: SatelliteCredentials): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) throw new Error(`Copernicus sign-in ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

const polygon = (ring: readonly LngLat[]) => ({ type: 'Polygon', coordinates: [[...ring, ring[0]]] });

// The farm with a margin around it, so the picture shows what borders it.
export function viewBox(ring: readonly LngLat[], marginM = 120): [number, number, number, number] {
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLat = marginM / 110_574;
  const dLng = marginM / (111_320 * Math.cos((midLat * Math.PI) / 180));
  return [Math.min(...lngs) - dLng, Math.min(...lats) - dLat, Math.max(...lngs) + dLng, Math.max(...lats) + dLat];
}

type StatsResponse = {
  data: { interval: { from: string }; outputs?: { ndvi?: { bands: { B0: { stats: { mean: number | 'NaN'; sampleCount: number; noDataCount: number } } } } } }[];
};

export async function monthlyNdvi(credentials: SatelliteCredentials, ring: readonly LngLat[], from: string, to: string): Promise<MonthlyView[]> {
  const res = await fetch(`${API}/statistics`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token(credentials)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: {
        bounds: { geometry: polygon(ring), properties: { crs: CRS84 } },
        data: [{ type: 'sentinel-2-l2a', dataFilter: { mosaickingOrder: 'leastCC' } }],
      },
      aggregation: {
        timeRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
        aggregationInterval: { of: 'P1M' },
        evalscript: NDVI_SCRIPT,
        resx: 0.0001,
        resy: 0.0001,
      },
    }),
  });
  if (!res.ok) throw new Error(`Copernicus statistics ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { data } = (await res.json()) as StatsResponse;
  return data.map(({ interval, outputs }) => {
    const stats = outputs?.ndvi?.bands.B0.stats;
    const clearShare = stats && stats.sampleCount ? (stats.sampleCount - stats.noDataCount) / stats.sampleCount : 0;
    const mean = stats && typeof stats.mean === 'number' && clearShare > 0 ? Math.round(stats.mean * 1000) / 1000 : null;
    return { month: interval.from.slice(0, 7), ndvi: mean, clearShare: Math.round(clearShare * 100) / 100 };
  });
}

// The least cloudy true-colour picture of the farm and its surroundings within a month.
export async function trueColourPicture(credentials: SatelliteCredentials, ring: readonly LngLat[], month: string): Promise<Uint8Array> {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59));
  const res = await fetch(`${API}/process`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token(credentials)}`, 'Content-Type': 'application/json', Accept: 'image/png' },
    body: JSON.stringify({
      input: {
        bounds: { bbox: viewBox(ring), properties: { crs: CRS84 } },
        data: [{ type: 'sentinel-2-l2a', dataFilter: { timeRange: { from: start.toISOString(), to: end.toISOString() }, mosaickingOrder: 'leastCC' } }],
      },
      output: { width: 256, height: 256, responses: [{ identifier: 'default', format: { type: 'image/png' } }] },
      evalscript: TRUE_COLOUR_SCRIPT,
    }),
  });
  if (!res.ok) throw new Error(`Copernicus picture ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return new Uint8Array(await res.arrayBuffer());
}
