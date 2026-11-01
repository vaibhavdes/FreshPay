import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { payoutItems, paypalOps } from '@/lib/db/schema';
import { recoverPendingOps, STALE_AFTER_MS } from '@/lib/services/recovery';
import { freshDb, NOW, stubPayPal } from '../helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

const op = (id: string, kind: string, paypalId: string, status: 'PENDING' | 'COMPLETED') => ({
  id,
  op: kind,
  key: `contract-1/${id}`,
  requestId: `req-${id}`,
  status,
  paypalId,
  createdAt: NOW,
  updatedAt: NOW,
});

describe('recoverPendingOps', () => {
  it('settles what PayPal finished while its webhooks were lost', async () => {
    const db = await freshDb();
    await db.insert(paypalOps).values([op('op-batch', 'payouts.batch', 'BATCH-1', 'PENDING'), op('op-capture', 'payments.capture', 'CAPTURE-1', 'PENDING')]);
    await db.insert(payoutItems).values([
      { id: 'item-farmer', opId: 'op-batch', payeeId: 'farmer-1', receiver: 'f@farmproof.test', cents: 1800, status: 'PENDING', updatedAt: NOW },
      { id: 'item-dealer', opId: 'op-batch', payeeId: 'dealer-1', receiver: 'd@farmproof.test', cents: 2700, status: 'PENDING', updatedAt: NOW },
    ]);
    stubPayPal((call) =>
      call.url.includes('/v1/payments/payouts/BATCH-1')
        ? Response.json({
            batch_header: { batch_status: 'SUCCESS' },
            items: [
              { payout_item_id: 'PI-1', transaction_status: 'SUCCESS', payout_item: { sender_item_id: 'item-farmer' } },
              { payout_item_id: 'PI-2', transaction_status: 'FAILED', payout_item: { sender_item_id: 'item-dealer' } },
            ],
          })
        : Response.json({ id: 'CAPTURE-1', status: 'COMPLETED' }),
    );

    expect(await recoverPendingOps(db, NOW + 1000)).toEqual({ checked: 0 });
    expect(await recoverPendingOps(db, NOW + STALE_AFTER_MS + 1)).toEqual({ checked: 2 });

    expect((await db.select().from(paypalOps)).map((o) => o.status)).toEqual(['COMPLETED', 'COMPLETED']);
    const [dealer] = await db.select().from(payoutItems).where(eq(payoutItems.id, 'item-dealer'));
    expect(dealer).toMatchObject({ status: 'FAILED', payoutItemId: 'PI-2' });
  });
});
