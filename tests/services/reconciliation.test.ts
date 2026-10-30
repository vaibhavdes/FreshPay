import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db/client';
import { paypalOps } from '@/lib/db/schema';
import { SEARCH_LAG_MS } from '@/lib/engine/reconcile';
import type { Transaction } from '@/lib/paypal';
import { latestReconciliation, runReconciliation } from '@/lib/services/reconciliation';
import { freshDb, NOW } from '../helpers';

const OLD = NOW - SEARCH_LAG_MS - 60_000;
const op = (id: string, kind: string, paypalId: string, cents: number) => ({
  id,
  op: kind,
  key: `contract-1/${id}`,
  requestId: `r-${id}`,
  status: 'COMPLETED' as const,
  paypalId,
  cents,
  createdAt: OLD,
  updatedAt: OLD,
});
const txn = (id: string, code: string, value: string): Transaction => ({
  transaction_info: { transaction_id: id, transaction_event_code: code, transaction_amount: { value, currency_code: 'USD' }, transaction_initiation_date: new Date(OLD).toISOString() },
});

let db: Db;

beforeEach(async () => {
  db = await freshDb();
  await db.insert(paypalOps).values([op('a', 'orders.capture', 'CAP-1', 764_700), op('b', 'payouts.batch', 'BATCH-1', 4_501), op('c', 'payments.refund', 'REF-1', 1_000)]);
});

describe('runReconciliation', () => {
  it('stores a run comparing our ledger with Transaction Search', async () => {
    const search = async () => [txn('CAP-1', 'T0006', '7647.00'), txn('REF-1', 'T1107', '-10.00'), txn('ITEM-1', 'T0400', '-45.01')];
    const run = await runReconciliation(db, { now: NOW, search });

    expect(run.result).toMatchObject({ matched: ['CAP-1', 'REF-1'], missingAtPayPal: [], payouts: { ourCents: 4_501, paypalCents: 4_501, match: true } });
    expect((await latestReconciliation(db))?.id).toBe(run.id);
  });

  it('flags a capture PayPal reports with a different amount', async () => {
    const run = await runReconciliation(db, { now: NOW, search: async () => [txn('CAP-1', 'T0006', '7640.00')] });
    expect(run.result.amountMismatches).toEqual([{ paypalId: 'CAP-1', ourCents: 764_700, paypalCents: 764_000 }]);
    expect(run.result.missingAtPayPal).toEqual(['REF-1']);
  });
});
