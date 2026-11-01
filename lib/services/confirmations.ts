import { randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { billConfirmations, farmers, inputDealers, milestones, plots } from '../db/schema';
import type { Allocation } from '../engine/splits';
import { conflict, notFound } from './errors';
import { appendLedger } from './ledger';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

// After a stage pays a seller, the seller is asked once to confirm the bill was theirs. Only the
// link's holder can answer; a "no" holds the farm's next claim for the field officer.
export async function askSellers(db: Db | Tx, milestoneId: string, payouts: readonly Allocation[], now: number) {
  const ids = payouts.filter((p) => p.cents > 0).map((p) => p.id);
  if (!ids.length) return;
  const sellers = await db.select({ id: inputDealers.id }).from(inputDealers).where(inArray(inputDealers.id, ids));
  if (!sellers.length) return;
  await db.insert(billConfirmations).values(
    payouts
      .filter((p) => sellers.some((s) => s.id === p.id))
      .map((p) => ({ id: randomBytes(12).toString('hex'), milestoneId, payeeId: p.id, cents: p.cents, status: 'WAITING' as const, createdAt: now })),
  );
}

export async function confirmation(db: Db, id: string) {
  const [row] = await db
    .select({
      confirmation: billConfirmations,
      seller: inputDealers.name,
      stage: milestones.label,
      type: milestones.type,
      plot: plots.name,
      plotId: plots.id,
      farmer: farmers.name,
    })
    .from(billConfirmations)
    .innerJoin(inputDealers, eq(billConfirmations.payeeId, inputDealers.id))
    .innerJoin(milestones, eq(billConfirmations.milestoneId, milestones.id))
    .innerJoin(plots, eq(milestones.plotId, plots.id))
    .innerJoin(farmers, eq(plots.farmerId, farmers.id))
    .where(eq(billConfirmations.id, id));
  if (!row) throw notFound('Bill confirmation');
  return row;
}

export async function answerConfirmation(db: Db, id: string, issued: boolean, now = Date.now()) {
  const { confirmation: row } = await confirmation(db, id);
  if (row.status !== 'WAITING') throw conflict('This bill has already been answered');
  const status = issued ? 'CONFIRMED' : 'DENIED';
  await db.update(billConfirmations).set({ status, decidedAt: now }).where(eq(billConfirmations.id, id));
  await appendLedger(db, { kind: issued ? 'SELLER_CONFIRMED' : 'SELLER_DENIED', milestoneId: row.milestoneId, payeeId: row.payeeId, cents: row.cents }, now);
  return status;
}

export async function sellerDeniedOnPlot(db: Db, plotId: string) {
  const [denied] = await db
    .select({ id: billConfirmations.id })
    .from(billConfirmations)
    .innerJoin(milestones, eq(billConfirmations.milestoneId, milestones.id))
    .where(and(eq(milestones.plotId, plotId), eq(billConfirmations.status, 'DENIED')))
    .limit(1);
  return Boolean(denied);
}

export const confirmationsFor = (db: Db, milestoneIds: string[]) =>
  milestoneIds.length ? db.select().from(billConfirmations).where(inArray(billConfirmations.milestoneId, milestoneIds)) : Promise.resolve([]);
