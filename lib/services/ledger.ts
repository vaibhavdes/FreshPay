import { asc, desc } from 'drizzle-orm';
import type { Db } from '../db/client';
import { ledgerReceipts } from '../db/schema';
import { appendReceipt, verifyChain, type Receipt } from '../engine/ledger';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export async function appendLedger(db: Db | Tx, payload: Record<string, unknown>, now = Date.now()): Promise<Receipt> {
  const [last] = await db.select().from(ledgerReceipts).orderBy(desc(ledgerReceipts.seq)).limit(1);
  const receipt = appendReceipt(last ?? null, payload);
  await db.insert(ledgerReceipts).values({ ...receipt, createdAt: now });
  return receipt;
}

export async function verifyLedger(db: Db) {
  return verifyChain(await db.select().from(ledgerReceipts).orderBy(asc(ledgerReceipts.seq)));
}
