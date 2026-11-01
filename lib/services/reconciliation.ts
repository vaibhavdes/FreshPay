import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { paypalOps, reconciliationRuns } from '../db/schema';
import { reconcile, type LedgerEntry, type PayPalTransaction } from '../engine/reconcile';
import { hasVaultAccount, searchTransactions, type Transaction } from '../paypal';
import { valueToCents } from '../paypal-sdk';

const KINDS: Record<string, LedgerEntry['kind']> = {
  'orders.capture': 'CAPTURE',
  'payments.capture': 'CAPTURE',
  'orders.vault-charge': 'CAPTURE',
  'payments.refund': 'REFUND',
  'payouts.batch': 'PAYOUT',
};

const WINDOW_DAYS = 7;

const toTransaction = ({ transaction_info: t }: Transaction): PayPalTransaction => ({
  transactionId: t.transaction_id,
  eventCode: t.transaction_event_code ?? '',
  cents: (t.transaction_amount?.value.startsWith('-') ? -1 : 1) * valueToCents((t.transaction_amount?.value ?? '0').replace('-', '')),
  at: t.transaction_initiation_date ? Date.parse(t.transaction_initiation_date) : 0,
});

// Compares the money our ledger moved in the last week with PayPal's Transaction Search.
export async function runReconciliation(db: Db, { now = Date.now(), search = searchTransactions } = {}) {
  const windowStart = now - WINDOW_DAYS * 86_400_000;
  const ops = await db
    .select()
    .from(paypalOps)
    .where(and(eq(paypalOps.status, 'COMPLETED'), isNotNull(paypalOps.cents), isNotNull(paypalOps.paypalId), gte(paypalOps.createdAt, windowStart)));
  const ours = ops.flatMap((op) => (KINDS[op.op] ? [{ paypalId: op.paypalId!, kind: KINDS[op.op], cents: op.cents!, at: op.createdAt }] : []));
  const vaultCharges = ops.some((op) => op.op === 'orders.vault-charge') && hasVaultAccount();
  const found = await Promise.all([search(new Date(windowStart), new Date(now)), ...(vaultCharges ? [search(new Date(windowStart), new Date(now), 'vault')] : [])]);
  const theirs = found.flat().map(toTransaction);

  const result = reconcile(ours, theirs, now);
  const [run] = await db.insert(reconciliationRuns).values({ id: randomUUID(), windowStart, windowEnd: now, result, createdAt: now }).returning();
  return run;
}

export async function latestReconciliation(db: Db) {
  const [run] = await db.select().from(reconciliationRuns).orderBy(desc(reconciliationRuns.createdAt)).limit(1);
  return run ?? null;
}
