import { and, eq, inArray, lt, ne, notInArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { payoutItems, paypalOps } from '../db/schema';
import { publish } from '../events';
import { paypalRequest } from '../paypal';

// A webhook can be lost. Anything PayPal left pending for this long is asked about directly.
export const STALE_AFTER_MS = 10 * 60_000;

const FINAL_ITEM_STATES = ['SUCCESS', 'FAILED', 'RETURNED', 'BLOCKED', 'REFUNDED', 'REVERSED'];

type Batch = {
  batch_header: { batch_status: string };
  items?: { payout_item_id: string; transaction_status: string; payout_item: { sender_item_id: string } }[];
};

// Where to read each kind of op back from PayPal, and which statuses settle it.
const LOOKUPS: Record<string, { path: (id: string) => string; completed: string[]; failed: string[] }> = {
  'orders.capture': { path: (id) => `/v2/payments/captures/${id}`, completed: ['COMPLETED'], failed: ['DECLINED', 'FAILED'] },
  'payments.capture': { path: (id) => `/v2/payments/captures/${id}`, completed: ['COMPLETED'], failed: ['DECLINED', 'FAILED'] },
  'orders.vault-charge': { path: (id) => `/v2/payments/captures/${id}`, completed: ['COMPLETED'], failed: ['DECLINED', 'FAILED'] },
  'payments.refund': { path: (id) => `/v2/payments/refunds/${id}`, completed: ['COMPLETED'], failed: ['FAILED', 'CANCELLED'] },
};

async function settleOp(db: Db, op: typeof paypalOps.$inferSelect, status: 'COMPLETED' | 'FAILED', issue: string | null, now: number) {
  await db
    .update(paypalOps)
    .set({ status, ...(status === 'FAILED' && { errorIssue: issue }), updatedAt: now })
    .where(and(eq(paypalOps.id, op.id), eq(paypalOps.status, 'PENDING')));
  publish({ type: 'paypal.op', opId: op.id, op: op.op, status, paypalId: op.paypalId, learnedFrom: 'SYNC' });
}

async function refreshBatch(db: Db, op: typeof paypalOps.$inferSelect, now: number) {
  const batch = await paypalRequest<Batch>(`/v1/payments/payouts/${op.paypalId}`);
  for (const item of batch.items ?? []) {
    const [updated] = await db
      .update(payoutItems)
      .set({ payoutItemId: item.payout_item_id, status: item.transaction_status, updatedAt: now })
      .where(and(eq(payoutItems.id, item.payout_item.sender_item_id), ne(payoutItems.status, item.transaction_status)))
      .returning();
    if (updated) publish({ type: 'payout.item', itemId: updated.id, payoutItemId: updated.payoutItemId, status: updated.status });
  }
  const status = batch.batch_header.batch_status;
  if (op.status === 'PENDING' && status === 'SUCCESS') await settleOp(db, op, 'COMPLETED', null, now);
  if (op.status === 'PENDING' && (status === 'DENIED' || status === 'CANCELED')) await settleOp(db, op, 'FAILED', `PAYOUT_BATCH_${status}`, now);
}

// Asks PayPal about every op still pending and every payout item not yet final, so a lost
// webhook never leaves money looking unpaid. Returns how many were looked up.
export async function recoverPendingOps(db: Db, now = Date.now()) {
  const stale = await db
    .select()
    .from(paypalOps)
    .where(and(eq(paypalOps.status, 'PENDING'), lt(paypalOps.updatedAt, now - STALE_AFTER_MS)));
  const openItems = await db.select({ opId: payoutItems.opId }).from(payoutItems).where(notInArray(payoutItems.status, FINAL_ITEM_STATES));
  const batchIds = [...new Set(openItems.map((i) => i.opId))];
  const batches = batchIds.length
    ? await db.select().from(paypalOps).where(and(inArray(paypalOps.id, batchIds), eq(paypalOps.op, 'payouts.batch'), lt(paypalOps.updatedAt, now - STALE_AFTER_MS)))
    : [];

  const checked: string[] = [];
  for (const op of [...stale, ...batches.filter((b) => !stale.some((s) => s.id === b.id))]) {
    if (!op.paypalId) continue;
    if (op.op === 'payouts.batch') await refreshBatch(db, op, now);
    else {
      const lookup = LOOKUPS[op.op];
      if (!lookup) continue;
      const { status } = await paypalRequest<{ status: string }>(lookup.path(op.paypalId));
      if (lookup.completed.includes(status)) await settleOp(db, op, 'COMPLETED', null, now);
      else if (lookup.failed.includes(status)) await settleOp(db, op, 'FAILED', status, now);
    }
    checked.push(op.id);
  }
  return { checked: checked.length };
}

let lastActiveRun = 0;

// Runs recovery in the background while someone has the app open, at most once per STALE_AFTER_MS.
// A payment left pending while nobody is looking is caught the next time someone opens the app.
export function recoverWhileActive(db: Db, now = Date.now()) {
  if (now - lastActiveRun < STALE_AFTER_MS) return;
  lastActiveRun = now;
  recoverPendingOps(db, now).catch((error: unknown) => console.error('Recovery failed', error instanceof Error ? error.message : error));
}
