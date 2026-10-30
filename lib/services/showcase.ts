import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { contracts, farmers, inputDealers, milestones, plots } from '../db/schema';
import { allocate } from '../engine/splits';

// The plots the landing page tells the story with: one that passes every check, one that fails.
export async function showcasePlots(db: Db) {
  const rows = await db
    .select({
      id: plots.id,
      name: plots.name,
      ring: plots.ring,
      areaHa: plots.areaHa,
      eudrStatus: plots.eudrStatus,
      eudrCheck: plots.eudrCheck,
      farmerId: farmers.id,
      farmer: farmers.name,
      dealer: inputDealers.name,
      inputsCents: milestones.trancheCents,
      inputsShares: milestones.shares,
    })
    .from(plots)
    .innerJoin(farmers, eq(plots.farmerId, farmers.id))
    .innerJoin(inputDealers, eq(plots.dealerId, inputDealers.id))
    .innerJoin(milestones, and(eq(milestones.plotId, plots.id), eq(milestones.type, 'INPUTS')))
    .orderBy(asc(plots.id));

  const [contract] = await db.select().from(contracts).limit(1);

  const story = (plot: (typeof rows)[number] | undefined) => {
    if (!plot) return null;
    const split = allocate(plot.inputsCents, plot.inputsShares);
    return {
      ...plot,
      lossHa: Number(plot.eudrCheck?.lossSince2021Ha ?? 0),
      farmerCents: split.find((s) => s.id === plot.farmerId)?.cents ?? 0,
      dealerCents: split.find((s) => s.id !== plot.farmerId)?.cents ?? 0,
    };
  };

  return {
    contract: contract ?? null,
    passing: story(rows.find((p) => p.eudrStatus === 'PASS')),
    failing: story(rows.find((p) => p.eudrStatus === 'FAIL')),
  };
}
