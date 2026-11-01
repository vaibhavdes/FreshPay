import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import { contracts, ledgerReceipts, plots } from '@/lib/db/schema';
import type { WeatherEvent } from '@/lib/engine/weather';
import { verifyLedger } from '@/lib/services/ledger';
import { freshDb, NOW, createSeason } from '../helpers';

const sdk = vi.hoisted(() => ({ refundCapturedPayment: vi.fn(), voidPayment: vi.fn() }));

vi.mock('@/lib/paypal-sdk', async (original) => ({
  ...(await original<typeof import('@/lib/paypal-sdk')>()),
  paypalSdk: () => ({ orders: {}, payments: sdk }),
}));

const { declareForceMajeure } = await import('@/lib/services/force-majeure');

const weather = (event: WeatherEvent) => async () => ({
  event,
  dates: event === 'NONE' ? [] : ['2026-11-04'],
  totalPrecipitationMm: event === 'NONE' ? 12 : 41,
  source: 'Open-Meteo',
  location: [75.771, 13.321] as const,
  startDate: '2026-11-01',
  endDate: '2026-11-07',
});

const window = { startDate: '2026-11-01', endDate: '2026-11-07' };

let db: Db;

beforeEach(async () => {
  vi.clearAllMocks();
  db = await freshDb();
  await createSeason(db);
  await db.update(plots).set({ valueCents: 600_000 }).where(eq(plots.id, 'plot-1'));
  await db.update(contracts).set({ state: 'ACTIVE', advanceCaptureId: 'CAPTURE-ADVANCE', escrowRemainingCents: 173_000 }).where(eq(contracts.id, 'contract-1'));
  sdk.refundCapturedPayment.mockResolvedValue({ result: { id: 'REFUND-1', status: 'COMPLETED' } });
  sdk.voidPayment.mockResolvedValue({ result: undefined });
});

describe('declareForceMajeure', () => {
  it('refunds the unearned advance after verified hail and ends the season', async () => {
    const { decision, contract } = await declareForceMajeure(db, 'contract-1', window, { check: weather('HAIL'), now: NOW });

    expect(decision).toEqual({ kind: 'REFUND', refundCents: 173_000, affectedPlotIds: ['plot-1'] });
    expect(sdk.refundCapturedPayment.mock.calls[0][0]).toMatchObject({ captureId: 'CAPTURE-ADVANCE', body: { amount: { value: '1730.00' } } });
    expect(contract).toMatchObject({ state: 'FRUSTRATED', escrowRemainingCents: 0, refundId: 'REFUND-1' });
    expect((await db.select().from(ledgerReceipts)).map((r) => r.payload.kind)).toEqual(['FORCE_MAJEURE_REFUNDED']);
    expect(await verifyLedger(db)).toEqual({ ok: true });
  });

  it('also voids a delivery authorization that is still open', async () => {
    await db.update(contracts).set({ state: 'DELIVERING', balanceAuthorizationId: 'AUTH-1', balanceAuthorizedCents: 400_000 }).where(eq(contracts.id, 'contract-1'));
    await declareForceMajeure(db, 'contract-1', window, { check: weather('FLOOD'), now: NOW });
    expect(sdk.voidPayment).toHaveBeenCalledWith(expect.objectContaining({ authorizationId: 'AUTH-1' }));
  });

  it('refunds nothing when the weather was normal', async () => {
    const { decision, contract } = await declareForceMajeure(db, 'contract-1', window, { check: weather('NONE'), now: NOW });
    expect(decision).toEqual({ kind: 'REJECT', reasons: ['NO_WEATHER_EVENT'] });
    expect(contract.state).toBe('ACTIVE');
    expect(sdk.refundCapturedPayment).not.toHaveBeenCalled();
  });
});
