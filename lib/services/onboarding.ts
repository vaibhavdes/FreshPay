import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { serialized } from '../db/lock';
import { contracts, cooperatives, farmers, inputDealers, milestones, plots } from '../db/schema';
import { eudrStatus, type GeoCheck } from '../engine/eudr';
import type { LngLat } from '../engine/geo';
import { publish } from '../events';
import { ADVANCE_PERCENT, areaHa, plotMilestones, plotValueCents, type Suppliers } from '../season-terms';
import { conflict, notFound } from './errors';
import { appendLedger } from './ledger';

const MIN_HA = 0.05;
const MAX_HA = 50;

export const PlotRegistration = z.object({
  contractId: z.string().min(1),
  farmerName: z.string().trim().min(2).max(80),
  paypalEmail: z.email(),
  plotName: z.string().trim().min(2).max(80),
  variety: z.enum(['arabica', 'robusta']),
  ring: z
    .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
    .min(3)
    .max(500),
});
export type PlotRegistration = z.infer<typeof PlotRegistration>;

export type LandChecker = (ring: readonly LngLat[]) => Promise<GeoCheck | null>;

// A field officer registers a farmer and the plot outline walked with a phone. The plot joins
// the season contract with the same milestones as every other plot; its payments stay closed
// until the land check passes.
export async function registerPlot(db: Db, input: PlotRegistration, checkLand: LandChecker, now = Date.now()) {
  return serialized(`contract:${input.contractId}`, async () => {
    const [contract] = await db.select().from(contracts).where(eq(contracts.id, input.contractId));
    if (!contract) throw notFound(`Contract ${input.contractId}`);
    if (contract.state === 'SETTLED' || contract.state === 'FRUSTRATED' || contract.state === 'DELIVERING') {
      throw conflict('This season is closed to new plots');
    }
    const area = areaHa(input.ring);
    if (area < MIN_HA || area > MAX_HA) throw conflict(`The outline covers ${area} ha. Walk the plot's boundary again; a plot is between ${MIN_HA} and ${MAX_HA} ha.`);

    const [cooperative] = await db.select().from(cooperatives).where(eq(cooperatives.id, contract.cooperativeId));
    const known = await db.select({ id: inputDealers.id, kind: inputDealers.kind }).from(inputDealers);
    const dealer = known.find((s) => s.kind === 'INPUTS');
    if (!dealer) throw conflict('Register an input seller before adding farms');
    const suppliers: Suppliers = { INPUTS: dealer.id, ...Object.fromEntries(known.filter((s) => s.kind !== 'INPUTS').map((s) => [s.kind, s.id])) };

    const check = await checkLand(input.ring);
    const farmerId = `farmer-${randomUUID().slice(0, 8)}`;
    const plotId = `plot-${randomUUID().slice(0, 8)}`;
    const valueCents = plotValueCents(input.variety, input.ring);

    const contractRow = await db.transaction(async (tx) => {
      await tx.insert(farmers).values({ id: farmerId, cooperativeId: contract.cooperativeId, name: input.farmerName, paypalEmail: input.paypalEmail, createdAt: now });
      await tx.insert(plots).values({
        id: plotId,
        farmerId,
        dealerId: dealer.id,
        name: input.plotName,
        country: cooperative.country,
        commodity: contract.commodity,
        variety: input.variety,
        ring: input.ring,
        areaHa: area,
        valueCents,
        eudrStatus: eudrStatus(check),
        eudrCheck: check,
        createdAt: now,
      });
      await tx.insert(milestones).values(plotMilestones({ contractId: contract.id, plotId, farmerId, suppliers, variety: input.variety, valueCents }));
      const totalCents = contract.totalCents + valueCents;
      // Before funding the advance grows with the contract; after, the buyer's payment is fixed.
      const [row] = await tx
        .update(contracts)
        .set({ totalCents, ...(contract.state === 'DRAFT' && { advanceCents: Math.round((totalCents * ADVANCE_PERCENT) / 10_000) * 100 }) })
        .where(eq(contracts.id, contract.id))
        .returning();
      await appendLedger(tx, { kind: 'PLOT_REGISTERED', contractId: contract.id, plotId, farmerId, areaHa: area, valueCents, landCheck: eudrStatus(check) }, now);
      return row;
    });

    publish({ type: 'contract', contractId: contract.id, state: contractRow.state, escrowRemainingCents: contractRow.escrowRemainingCents });
    return { plotId, farmerId, areaHa: area, valueCents, landCheck: eudrStatus(check) };
  });
}
