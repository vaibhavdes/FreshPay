import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { satelliteViews } from '../db/schema';
import type { LngLat } from '../engine/geo';
import type { MonthlyView } from '../engine/satellite';
import { env } from '../env';
import { monthlyNdvi, trueColourPicture, type SatelliteCredentials } from '../oracles/satellite';

const DAY = 24 * 60 * 60_000;
const MONTHS_BACK = 12;
const PICTURES = 4;
// A month's view is final once it is over; the current month is refetched after a few days.
const REFRESH_AFTER_MS = 5 * DAY;

export const ringKey = (ring: readonly LngLat[]) => createHash('sha256').update(JSON.stringify(ring)).digest('hex').slice(0, 24);

export function satelliteCredentials(): SatelliteCredentials | null {
  const { CDSE_CLIENT_ID, CDSE_CLIENT_SECRET } = env();
  return CDSE_CLIENT_ID && CDSE_CLIENT_SECRET ? { clientId: CDSE_CLIENT_ID, clientSecret: CDSE_CLIENT_SECRET } : null;
}

export async function viewsOf(db: Db, ring: readonly LngLat[]) {
  const rows = await db
    .select({ month: satelliteViews.month, ndvi: satelliteViews.ndvi, clearShare: satelliteViews.clearShare, picture: satelliteViews.picture, fetchedAt: satelliteViews.fetchedAt })
    .from(satelliteViews)
    .where(eq(satelliteViews.ringKey, ringKey(ring)))
    .orderBy(asc(satelliteViews.month));
  return rows.map(({ picture, ...row }) => ({ ...row, hasPicture: picture !== null }));
}

export async function viewPicture(db: Db, ring: readonly LngLat[], month: string) {
  const [row] = await db
    .select({ picture: satelliteViews.picture })
    .from(satelliteViews)
    .where(and(eq(satelliteViews.ringKey, ringKey(ring)), eq(satelliteViews.month, month)));
  return row?.picture ?? null;
}

// The clearest month in each stretch of the year, newest first, for the picture timeline.
export function picturesToTake(views: readonly MonthlyView[], count = PICTURES): string[] {
  const clear = views.filter((v) => v.ndvi !== null && v.clearShare >= 0.6);
  const size = Math.ceil(views.length / count);
  const picks: string[] = [];
  for (let end = views.length; end > 0 && picks.length < count; end -= size) {
    const stretch = clear.filter((v) => views.indexOf(v) >= end - size && views.indexOf(v) < end);
    const best = stretch.sort((a, b) => b.clearShare - a.clearShare)[0];
    if (best) picks.push(best.month);
  }
  return picks;
}

// Fetches the last year of monthly views for a farm, and pictures for the clearest months.
export async function refreshSatellite(db: Db, ring: readonly LngLat[], credentials: SatelliteCredentials, now = Date.now()) {
  const known = await viewsOf(db, ring);
  const thisMonth = new Date(now).toISOString().slice(0, 7);
  const current = known.find((v) => v.month === thisMonth);
  if (known.length >= MONTHS_BACK && current && now - current.fetchedAt < REFRESH_AFTER_MS) return known;

  const to = new Date(now).toISOString().slice(0, 10);
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - (MONTHS_BACK - 1), 1);
  const views = await monthlyNdvi(credentials, ring, start.toISOString().slice(0, 10), to);

  const key = ringKey(ring);
  const withPicture = new Set(known.filter((v) => v.hasPicture).map((v) => v.month));
  for (const view of views) {
    await db
      .insert(satelliteViews)
      .values({ ringKey: key, ...view, fetchedAt: now })
      .onConflictDoUpdate({ target: [satelliteViews.ringKey, satelliteViews.month], set: { ndvi: view.ndvi, clearShare: view.clearShare, fetchedAt: now } });
  }
  for (const month of picturesToTake(views).filter((m) => !withPicture.has(m))) {
    const picture = await trueColourPicture(credentials, ring, month);
    await db
      .update(satelliteViews)
      .set({ picture: Buffer.from(picture) })
      .where(and(eq(satelliteViews.ringKey, key), eq(satelliteViews.month, month)));
  }
  return viewsOf(db, ring);
}

// Starts a refresh in the background for pages and claims; failures only cost the signal.
const inFlight = new Set<string>();
export function refreshInBackground(db: Db, ring: readonly LngLat[]) {
  const credentials = satelliteCredentials();
  const key = ringKey(ring);
  if (!credentials || inFlight.has(key)) return;
  inFlight.add(key);
  refreshSatellite(db, ring, credentials)
    .catch((error: unknown) => console.error('Satellite refresh failed', error instanceof Error ? error.message : error))
    .finally(() => inFlight.delete(key));
}
