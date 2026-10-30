import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db/client';
import { payoutItems, paypalOps, webhookEvents } from '@/lib/db/schema';
import { handleWebhookEvent } from '@/lib/services/webhooks';
import { certUrlAllowed } from '@/lib/webhooks';
import { freshDb, NOW } from '../helpers';

let db: Db;

beforeEach(async () => {
  db = await freshDb();
  await db.insert(paypalOps).values({
    id: 'op-1',
    op: 'payouts.batch',
    key: 'contract-1/plot-1/INPUTS/release/v1',
    requestId: 'agritranche-abc',
    status: 'PENDING',
    paypalId: 'BATCH-1',
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(payoutItems).values({ id: 'item-1', opId: 'op-1', payeeId: 'farmer-1', receiver: 'farmer1@example.com', cents: 1800, status: 'PENDING', updatedAt: NOW });
});

const batchSuccess = { id: 'WH-1', event_type: 'PAYMENT.PAYOUTSBATCH.SUCCESS', resource: { batch_header: { payout_batch_id: 'BATCH-1' } } };

describe('handleWebhookEvent', () => {
  it('lets the webhook complete an op the sync response left pending', async () => {
    await handleWebhookEvent(db, batchSuccess, NOW + 1200);
    const [op] = await db.select().from(paypalOps);
    expect(op).toMatchObject({ status: 'COMPLETED', learnedFrom: 'WEBHOOK', webhookMs: 1200 });
  });

  it('counts replays without applying them twice', async () => {
    expect(await handleWebhookEvent(db, batchSuccess, NOW + 1000)).toEqual({ duplicate: false });
    expect(await handleWebhookEvent(db, batchSuccess, NOW + 5000)).toEqual({ duplicate: true });

    const [event] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, 'WH-1'));
    const [op] = await db.select().from(paypalOps);
    expect(event.replayCount).toBe(1);
    expect(op.webhookMs).toBe(1000);
  });

  it('tracks each payout item, including unclaimed ones', async () => {
    await handleWebhookEvent(
      db,
      {
        id: 'WH-2',
        event_type: 'PAYMENT.PAYOUTS-ITEM.UNCLAIMED',
        resource: { payout_item_id: 'PI-9', transaction_status: 'UNCLAIMED', payout_item: { sender_item_id: 'item-1' } },
      },
      NOW,
    );
    const [item] = await db.select().from(payoutItems);
    expect(item).toMatchObject({ payoutItemId: 'PI-9', status: 'UNCLAIMED' });
  });
});

describe('certUrlAllowed', () => {
  it('only trusts PayPal certificate hosts over https', () => {
    expect(certUrlAllowed('https://api.sandbox.paypal.com/v1/notifications/certs/CERT-123')).toBe(true);
    expect(certUrlAllowed('http://api.sandbox.paypal.com/cert')).toBe(false);
    expect(certUrlAllowed('https://paypal.com.evil.example/cert')).toBe(false);
    expect(certUrlAllowed('not a url')).toBe(false);
  });
});
