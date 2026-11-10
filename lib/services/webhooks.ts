import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { payoutItems, paypalOps, webhookEvents, type OpStatus } from '../db/schema';
import { nextItemStatus } from '../engine/payout-status';
import { publish } from '../events';
import type { PayPalWebhookEvent } from '../webhooks';
import { syncDispute } from './disputes';
import { syncSubscription } from './subscription';

type PayoutItemResource = {
  payout_item_id?: string;
  transaction_status?: string;
  payout_item?: { sender_item_id?: string };
};

export function resourceIdOf(event: PayPalWebhookEvent): string | null {
  const { resource } = event;
  if (event.event_type.startsWith('PAYMENT.PAYOUTSBATCH.')) {
    return (resource.batch_header as { payout_batch_id?: string } | undefined)?.payout_batch_id ?? null;
  }
  if (event.event_type.startsWith('PAYMENT.PAYOUTS-ITEM.')) return (resource as PayoutItemResource).payout_item_id ?? null;
  if (event.event_type.startsWith('CUSTOMER.DISPUTE.')) return typeof resource.dispute_id === 'string' ? resource.dispute_id : null;
  return typeof resource.id === 'string' ? resource.id : null;
}

// Only these events settle a pending op; any other event about it just records its arrival.
const COMPLETES = new Set([
  'PAYMENT.PAYOUTSBATCH.SUCCESS',
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.AUTHORIZATION.CREATED',
  'PAYMENT.AUTHORIZATION.VOIDED',
  'CHECKOUT.ORDER.COMPLETED',
]);
const FAILS = new Set(['PAYMENT.PAYOUTSBATCH.DENIED', 'PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.DECLINED']);

// The webhook is the second messenger: it confirms an op the sync response may already have
// completed, and records how long it took to arrive.
async function confirmOp(db: Db, paypalId: string, eventType: string, now: number) {
  const [op] = await db.select().from(paypalOps).where(eq(paypalOps.paypalId, paypalId));
  if (!op) return;

  const outcome: OpStatus | null = COMPLETES.has(eventType) ? 'COMPLETED' : FAILS.has(eventType) ? 'FAILED' : null;
  const wonRace = op.status === 'PENDING' && outcome !== null;
  if (op.webhookMs !== null && !wonRace) return;
  const [updated] = await db
    .update(paypalOps)
    .set({
      webhookMs: op.webhookMs ?? now - op.createdAt,
      ...(wonRace && { status: outcome!, learnedFrom: 'WEBHOOK' as const }),
      ...(wonRace && outcome === 'FAILED' && { errorIssue: eventType }),
      updatedAt: now,
    })
    .where(eq(paypalOps.id, op.id))
    .returning();
  publish({ type: 'paypal.op', opId: op.id, op: op.op, status: updated.status, paypalId, learnedFrom: 'WEBHOOK' });
}

async function applyPayoutItem(db: Db, resource: PayoutItemResource, now: number) {
  const itemId = resource.payout_item?.sender_item_id;
  if (!itemId || !resource.transaction_status) return;

  const [current] = await db.select({ status: payoutItems.status }).from(payoutItems).where(eq(payoutItems.id, itemId));
  if (!current) return;
  const status = nextItemStatus(current.status, resource.transaction_status);
  if (status === current.status && status !== resource.transaction_status) return;
  const [item] = await db
    .update(payoutItems)
    .set({ payoutItemId: resource.payout_item_id ?? null, status, updatedAt: now })
    .where(eq(payoutItems.id, itemId))
    .returning();
  if (item) publish({ type: 'payout.item', itemId, payoutItemId: item.payoutItemId, status: item.status });
}

export async function handleWebhookEvent(db: Db, event: PayPalWebhookEvent, now = Date.now()): Promise<{ duplicate: boolean }> {
  const resourceId = resourceIdOf(event);
  const inserted = await db
    .insert(webhookEvents)
    .values({ id: event.id, eventType: event.event_type, resourceId, payload: event, receivedAt: now })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });

  if (inserted.length === 0) {
    await db
      .update(webhookEvents)
      .set({ replayCount: sql`${webhookEvents.replayCount} + 1` })
      .where(eq(webhookEvents.id, event.id));
    return { duplicate: true };
  }

  try {
    if (event.event_type.startsWith('PAYMENT.PAYOUTS-ITEM.')) await applyPayoutItem(db, event.resource, now);
    else if (event.event_type.startsWith('CUSTOMER.DISPUTE.') && resourceId) {
      const dispute = await syncDispute(db, resourceId, now);
      if (dispute.contractId) publish({ type: 'dispute', contractId: dispute.contractId, disputeId: dispute.id, status: dispute.status });
    } else if (event.event_type.startsWith('BILLING.SUBSCRIPTION.') && resourceId) await syncSubscription(db, resourceId, now);
    else if (resourceId) await confirmOp(db, resourceId, event.event_type, now);
  } catch (error) {
    // Forget the event so PayPal's redelivery is processed rather than dropped as a replay.
    await db.delete(webhookEvents).where(eq(webhookEvents.id, event.id));
    throw error;
  }
  return { duplicate: false };
}
