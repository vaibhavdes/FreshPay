import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import { contracts, farmers, ledgerReceipts, milestones, plots } from '@/lib/db/schema';
import { valueToCents } from '@/lib/paypal-sdk';
import { verifyLedger } from '@/lib/services/ledger';
import { freshDb, NOW, seed, stubPayPal } from '../helpers';

const sdk = vi.hoisted(() => ({
  createOrder: vi.fn(),
  authorizeOrder: vi.fn(),
  createOrderTracking: vi.fn(),
  captureAuthorizedPayment: vi.fn(),
  voidPayment: vi.fn(),
}));

vi.mock('@/lib/paypal-sdk', async (original) => ({
  ...(await original<typeof import('@/lib/paypal-sdk')>()),
  paypalSdk: () => ({
    orders: { createOrder: sdk.createOrder, authorizeOrder: sdk.authorizeOrder, createOrderTracking: sdk.createOrderTracking },
    payments: { captureAuthorizedPayment: sdk.captureAuthorizedPayment, voidPayment: sdk.voidPayment },
  }),
}));

const { authorizeBalance, createBalanceOrder, deliverySummary, settleDelivery } = await import('@/lib/services/delivery');

let db: Db;

beforeEach(async () => {
  db = await freshDb();
  await seed(db);
  await db.insert(farmers).values({ id: 'farmer-2', cooperativeId: 'coop-1', name: 'Savitha', paypalEmail: 'farmer2@example.com', createdAt: NOW });
  await db.insert(plots).values({ id: 'plot-2', farmerId: 'farmer-2', name: 'Cleared plot', country: 'IN', commodity: 'coffee', ring: [[75.33, 13.23], [75.331, 13.23], [75.331, 13.231]], areaHa: 0.8, valueCents: 400_000, eudrStatus: 'FAIL', createdAt: NOW });
  await db.insert(milestones).values({ id: 'm-2', contractId: 'contract-1', plotId: 'plot-2', type: 'PLOT_VERIFIED', state: 'PENDING', opensAt: NOW, closesAt: NOW, trancheCents: 2500, shares: [{ id: 'farmer-2', weight: 1 }] });
  await db.update(plots).set({ valueCents: 600_000 }).where(eq(plots.id, 'plot-1'));
  await db.update(contracts).set({ state: 'ACTIVE' }).where(eq(contracts.id, 'contract-1'));

  sdk.createOrder.mockResolvedValue({ result: { id: 'ORDER-BAL' } });
  sdk.authorizeOrder.mockResolvedValue({ result: { purchaseUnits: [{ payments: { authorizations: [{ id: 'AUTH-1', amount: { currencyCode: 'USD', value: '4000.00' } }] } }] } });
  sdk.captureAuthorizedPayment.mockResolvedValue({ result: { id: 'CAPTURE-1' } });
  sdk.createOrderTracking.mockResolvedValue({ result: { id: 'ORDER-BAL' } });
  sdk.voidPayment.mockResolvedValue({ result: undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('delivery and settlement', () => {
  it('owes only the compliant coffee and names the plots left out', async () => {
    expect(await deliverySummary(db, 'contract-1')).toMatchObject({ balanceDueCents: 600_000 - 200_000, excludedPlots: ['Cleared plot'] });
  });

  it('authorizes the balance, captures what QC accepted, tracks the lot and pays compliant farmers', async () => {
    const calls = stubPayPal(() => Response.json({ batch_header: { payout_batch_id: 'BATCH-BAL' } }, { status: 201 }));

    expect(await createBalanceOrder(db, 'contract-1')).toBe('ORDER-BAL');
    expect(sdk.createOrder.mock.calls[0][0].body.purchaseUnits[0].amount).toEqual({ currencyCode: 'USD', value: '4000.00' });

    const authorized = await authorizeBalance(db, 'contract-1', 'ORDER-BAL', NOW);
    expect(authorized).toMatchObject({ state: 'DELIVERING', balanceAuthorizationId: 'AUTH-1', balanceAuthorizedCents: 400_000 });

    const settled = await settleDelivery(db, 'contract-1', { deliveredKg: 1_000, acceptedKg: 920, qualityPercent: 100, carrier: 'Maersk', trackingNumber: 'MSKU1234567' }, NOW);
    expect(settled).toMatchObject({ captureCents: 368_000, voidCents: 32_000, captureId: 'CAPTURE-1', payoutBatchId: 'BATCH-BAL', contract: { state: 'SETTLED' } });
    expect(sdk.captureAuthorizedPayment.mock.calls[0][0]).toMatchObject({ authorizationId: 'AUTH-1', body: { amount: { value: '3680.00' }, finalCapture: true } });
    expect(sdk.createOrderTracking.mock.calls[0][0]).toMatchObject({ id: 'ORDER-BAL', body: { captureId: 'CAPTURE-1', trackingNumber: 'MSKU1234567', carrierNameOther: 'Maersk' } });

    const batch = calls[0].body as { items: { receiver: string; amount: { value: string } }[] };
    expect(batch.items).toEqual([expect.objectContaining({ receiver: 'farmer1@example.com', amount: { value: '3680.00', currency: 'USD' } })]);

    expect((await db.select().from(ledgerReceipts)).map((r) => r.payload.kind)).toEqual(['BALANCE_AUTHORIZED', 'BALANCE_CAPTURED', 'SETTLED']);
    expect(await verifyLedger(db)).toEqual({ ok: true });
  });

  it('voids the whole authorization when QC rejects the lot', async () => {
    await createBalanceOrder(db, 'contract-1');
    await authorizeBalance(db, 'contract-1', 'ORDER-BAL', NOW);

    const settled = await settleDelivery(db, 'contract-1', { deliveredKg: 1_000, acceptedKg: 0, qualityPercent: 100, carrier: 'Maersk', trackingNumber: 'MSKU1' }, NOW);
    expect(settled).toMatchObject({ captureCents: 0, voidCents: 400_000, captureId: null, payoutBatchId: null });
    expect(sdk.voidPayment).toHaveBeenCalledWith(expect.objectContaining({ authorizationId: 'AUTH-1' }));
    expect(sdk.captureAuthorizedPayment).not.toHaveBeenCalled();
  });

  it('refuses to settle before the balance is authorized', async () => {
    await expect(settleDelivery(db, 'contract-1', { deliveredKg: 1, acceptedKg: 1, qualityPercent: 100, carrier: 'x', trackingNumber: 'y' })).rejects.toThrow('no authorized balance');
  });
});

describe('valueToCents', () => {
  it('parses PayPal amounts without floating point', () => {
    expect(valueToCents('4000.00')).toBe(400_000);
    expect(valueToCents('0.1')).toBe(10);
    expect(valueToCents('19')).toBe(1900);
    expect(() => valueToCents('1.234')).toThrow(RangeError);
  });
});
