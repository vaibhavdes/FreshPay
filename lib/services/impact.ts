import { and, eq, inArray, like } from 'drizzle-orm';
import type { Db } from '../db/client';
import { contracts, evidence, milestones, payoutItems, paypalOps, plots } from '../db/schema';

export type SeasonImpact = {
  paidCents: number;
  supplierCents: number;
  valuePercent: number;
  medianMinutes: number | null;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// What this season's stage payments have done, read from the payouts PayPal accepted.
export async function seasonImpact(db: Db, contractId: string): Promise<SeasonImpact> {
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  const ops = await db
    .select()
    .from(paypalOps)
    .where(and(eq(paypalOps.op, 'payouts.batch'), eq(paypalOps.status, 'COMPLETED'), like(paypalOps.key, `${contractId}/%/release/%`)));
  const items = ops.length ? (await db.select().from(payoutItems).where(inArray(payoutItems.opId, ops.map((o) => o.id)))).filter((i) => i.status !== 'FAILED' && i.status !== 'RETURNED') : [];
  const farmerIds = new Set((await db.select({ farmerId: plots.farmerId }).from(plots)).map((p) => p.farmerId));

  const stages = await db.select().from(milestones).where(and(eq(milestones.contractId, contractId), eq(milestones.state, 'RELEASED')));
  const photos = stages.length ? await db.select().from(evidence).where(and(inArray(evidence.milestoneId, stages.map((m) => m.id)), eq(evidence.kind, 'PHOTO'))) : [];
  const minutes = stages.flatMap((m) => {
    const op = ops.find((o) => o.key.startsWith(`${contractId}/${m.plotId}/${m.type}/`));
    const sent = photos.filter((p) => p.milestoneId === m.id && op && p.createdAt <= op.updatedAt).sort((a, b) => b.createdAt - a.createdAt)[0];
    return op && sent ? [(op.updatedAt - sent.createdAt) / 60_000] : [];
  });

  const paidCents = items.reduce((sum, i) => sum + i.cents, 0);
  return {
    paidCents,
    supplierCents: items.filter((i) => !farmerIds.has(i.payeeId)).reduce((sum, i) => sum + i.cents, 0),
    valuePercent: contract?.totalCents ? (paidCents / contract.totalCents) * 100 : 0,
    medianMinutes: median(minutes),
  };
}
