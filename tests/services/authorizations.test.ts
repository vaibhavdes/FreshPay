import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { contracts, ledgerReceipts, paypalOps } from '@/lib/db/schema';
import { sweepAuthorizations } from '@/lib/services/authorizations';
import { freshDb, NOW, seed } from '../helpers';

const sdk = vi.hoisted(() => ({ reauthorizePayment: vi.fn() }));

vi.mock('@/lib/paypal-sdk', async (original) => ({
  ...(await original<typeof import('@/lib/paypal-sdk')>()),
  paypalSdk: () => ({ payments: { reauthorizePayment: sdk.reauthorizePayment } }),
}));

const DAY = 24 * 60 * 60_000;

describe('sweepAuthorizations', () => {
  it('reauthorizes a delivery balance after its honour period, once per day', async () => {
    const db = await freshDb();
    await seed(db);
    await db.update(contracts).set({ state: 'DELIVERING', balanceAuthorizationId: 'AUTH-1', balanceAuthorizedCents: 400_000 }).where(eq(contracts.id, 'contract-1'));
    await db.insert(paypalOps).values({ id: 'op-auth', op: 'orders.authorize', key: 'contract-1/balance/authorize', requestId: 'r', status: 'COMPLETED', paypalId: 'AUTH-1', createdAt: NOW, updatedAt: NOW });
    sdk.reauthorizePayment.mockResolvedValue({ result: { id: 'AUTH-2' } });

    expect(await sweepAuthorizations(db, NOW + DAY)).toEqual([{ contractId: 'contract-1', action: 'NONE' }]);
    expect(await sweepAuthorizations(db, NOW + 3 * DAY)).toEqual([{ contractId: 'contract-1', action: 'REAUTHORIZE', authorizationId: 'AUTH-2' }]);
    expect(sdk.reauthorizePayment).toHaveBeenCalledWith(expect.objectContaining({ authorizationId: 'AUTH-1' }));
    expect(await sweepAuthorizations(db, NOW + 3 * DAY + 60_000)).toEqual([{ contractId: 'contract-1', action: 'NONE' }]);

    const [contract] = await db.select().from(contracts).where(eq(contracts.id, 'contract-1'));
    expect(contract.balanceAuthorizationId).toBe('AUTH-2');
    expect((await db.select().from(ledgerReceipts)).map((r) => r.payload.kind)).toEqual(['BALANCE_REAUTHORIZED']);
    expect(await sweepAuthorizations(db, NOW + 30 * DAY)).toEqual([{ contractId: 'contract-1', action: 'EXPIRED' }]);
  });
});
