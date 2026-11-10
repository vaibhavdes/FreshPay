import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import { payoutItems, paypalOps, webhookEvents } from '@/lib/db/schema';
import { handleWebhookEvent } from '@/lib/services/webhooks';
import { certUrlAllowed } from '@/lib/webhooks';
import { freshDb, NOW, stubPayPal } from '../helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

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
  await db.insert(payoutItems).values({ id: 'item-1', opId: 'op-1', payeeId: 'farmer-1', receiver: 'farmer1@farmproof.test', cents: 1800, status: 'PENDING', updatedAt: NOW });
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

  it('never lets a late event undo a payment that succeeded', async () => {
    const event = (id: string, status: string) => ({ id, event_type: `PAYMENT.PAYOUTS-ITEM.${status}`, resource: { payout_item_id: 'PI-9', transaction_status: status, payout_item: { sender_item_id: 'item-1' } } });
    await handleWebhookEvent(db, event('WH-S', 'SUCCEEDED') as never, NOW);
    await db.update(payoutItems).set({ status: 'SUCCESS' });
    await handleWebhookEvent(db, event('WH-U', 'UNCLAIMED') as never, NOW + 1);
    expect((await db.select().from(payoutItems))[0].status).toBe('SUCCESS');
    await handleWebhookEvent(db, event('WH-R', 'RETURNED') as never, NOW + 2);
    expect((await db.select().from(payoutItems))[0].status).toBe('RETURNED');
    await handleWebhookEvent(db, { id: 'WH-X', event_type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', resource: { transaction_status: 'SUCCESS', payout_item: { sender_item_id: 'missing' } } } as never, NOW + 3);
  });
});

describe('webhook outcomes', () => {
  it('fails a pending op on a denial, even after a neutral event arrived first', async () => {
    await handleWebhookEvent(db, { id: 'WH-3', event_type: 'PAYMENT.PAYOUTSBATCH.PROCESSING', resource: { batch_header: { payout_batch_id: 'BATCH-1' } } }, NOW + 500);
    expect((await db.select().from(paypalOps))[0]).toMatchObject({ status: 'PENDING', webhookMs: 500 });

    await handleWebhookEvent(db, { id: 'WH-4', event_type: 'PAYMENT.PAYOUTSBATCH.DENIED', resource: { batch_header: { payout_batch_id: 'BATCH-1' } } }, NOW + 900);
    expect((await db.select().from(paypalOps))[0]).toMatchObject({ status: 'FAILED', learnedFrom: 'WEBHOOK', errorIssue: 'PAYMENT.PAYOUTSBATCH.DENIED', webhookMs: 500 });
  });

  it('processes a redelivery when the first delivery failed midway', async () => {
    const disputeOpened = { id: 'WH-5', event_type: 'CUSTOMER.DISPUTE.CREATED', resource: { dispute_id: 'PP-D-1' } };
    stubPayPal(() => Response.json({ name: 'INTERNAL_SERVER_ERROR' }, { status: 500 }));

    await expect(handleWebhookEvent(db, disputeOpened, NOW)).rejects.toThrow();
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
  });
});

describe('certUrlAllowed', () => {
  it('only trusts PayPal certificate hosts over https', () => {
    expect(certUrlAllowed('https://api.sandbox.paypal.com/v1/notifications/certs/CERT-123')).toBe(true);
    expect(certUrlAllowed('http://api.sandbox.paypal.com/cert')).toBe(false);
    expect(certUrlAllowed('https://paypal.com.evil.test/cert')).toBe(false);
    expect(certUrlAllowed('not a url')).toBe(false);
  });
});
