import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { openDb, type Db } from '@/lib/db/client';
import { buyers, contracts, cooperatives, farmers, inputDealers, milestones, plots } from '@/lib/db/schema';

export const NOW = Date.UTC(2026, 10, 3, 6, 0);
export const DAY = 24 * 60 * 60_000;

export const freshDb = () => openDb(`file:${join(tmpdir(), `agritranche-test-${randomUUID()}.db`)}`);

export async function createSeason(db: Db) {
  await db.insert(buyers).values({ id: 'buyer-1', name: 'EU Roaster', country: 'DE', paypalEmail: 'buyer@farmproof.test', createdAt: NOW });
  await db.insert(cooperatives).values({ id: 'coop-1', name: 'Baba Budangiri FPO', region: 'Karnataka', country: 'IN', createdAt: NOW });
  await db.insert(farmers).values({ id: 'farmer-1', cooperativeId: 'coop-1', name: 'Lakshmi', paypalEmail: 'farmer1@farmproof.test', createdAt: NOW });
  await db.insert(inputDealers).values({ id: 'dealer-1', name: 'Agro Inputs', paypalEmail: 'dealer@farmproof.test', createdAt: NOW });
  await db.insert(plots).values({
    id: 'plot-1',
    farmerId: 'farmer-1',
    dealerId: 'dealer-1',
    name: 'Hill plot 1',
    country: 'IN',
    commodity: 'coffee',
    ring: [
      [75.77, 13.32],
      [75.772, 13.32],
      [75.772, 13.322],
      [75.77, 13.322],
    ],
    areaHa: 4.8,
    eudrStatus: 'PASS',
    createdAt: NOW,
  });
  await db.insert(contracts).values({
    id: 'contract-1',
    buyerId: 'buyer-1',
    cooperativeId: 'coop-1',
    commodity: 'coffee',
    season: '2026-27',
    currency: 'USD',
    totalCents: 500_000,
    advanceCents: 200_000,
    escrowRemainingCents: 200_000,
    state: 'FUNDED',
    createdAt: NOW,
  });
  const window = { opensAt: NOW - DAY, closesAt: NOW + 30 * DAY };
  await db.insert(milestones).values([
    { id: 'm-verified', contractId: 'contract-1', plotId: 'plot-1', type: 'PLOT_VERIFIED', state: 'PENDING', ...window, trancheCents: 2500, shares: [{ id: 'farmer-1', weight: 1 }] },
    {
      id: 'm-inputs',
      contractId: 'contract-1',
      plotId: 'plot-1',
      type: 'INPUTS',
      state: 'PENDING',
      ...window,
      trancheCents: 4501,
      shares: [
        { id: 'dealer-1', weight: 60 },
        { id: 'farmer-1', weight: 40 },
      ],
    },
  ]);
}

export type PayPalCall = { url: string; method: string; headers: Record<string, string>; body: unknown };

// Stubs fetch for the REST client: OAuth always succeeds, everything else goes to `respond`.
export function stubPayPal(respond: (call: PayPalCall) => Response) {
  const calls: PayPalCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'test-token', expires_in: 32400 });
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      const call = { url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body };
      calls.push(call);
      return respond(call);
    }),
  );
  return calls;
}
