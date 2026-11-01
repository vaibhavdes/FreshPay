import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { serialized } from '../db/lock';
import { contracts, cooperatives, farmers, inputDealers, milestones, plots } from '../db/schema';
import { eudrStatus, type GeoCheck } from '../engine/eudr';
import type { LngLat } from '../engine/geo';
import { publish } from '../events';
import { insideCountry, payoutCountry } from '../countries';
import { templateFor } from '../programmes';
import { areaHa, coffeeTerms, plotMilestones, termsValueCents, type Suppliers } from '../season-terms';
import { conflict, notFound } from './errors';
import { appendLedger } from './ledger';

const MIN_HA = 0.05;
const MAX_HA = 50;

export const PlotRegistration = z.object({
  contractId: z.string().min(1),
  farmerName: z.string().trim().min(2).max(80),
  paypalEmail: z.email(),
  plotName: z.string().trim().min(2).max(80),
  // Only the coffee season prices plots by variety; an opportunity's terms fix one crop.
  variety: z.enum(['arabica', 'robusta']).optional(),
  ring: z
    .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
    .min(3)
    .max(500),
});
export type PlotRegistration = z.infer<typeof PlotRegistration>;

export type LandChecker = (ring: readonly LngLat[]) => Promise<GeoCheck | null>;

// A field officer (or the farmer, on an opportunity) registers a farmer and the plot outline
// walked with a phone. The plot joins the season contract with the same stages as every other
// plot; its payments stay closed until the land check passes.
// payerId: the farmer's verified PayPal account when they signed in with PayPal.
export async function registerPlot(db: Db, input: PlotRegistration, checkLand: LandChecker, now = Date.now(), payerId: string | null = null) {
  return serialized(`contract:${input.contractId}`, async () => {
    const [contract] = await db.select().from(contracts).where(eq(contracts.id, input.contractId));
    if (!contract) throw notFound(`Contract ${input.contractId}`);
    if (contract.state === 'SETTLED' || contract.state === 'FRUSTRATED' || contract.state === 'DELIVERING') {
      throw conflict('This season is closed to new plots');
    }
    const area = areaHa(input.ring);
    if (area < MIN_HA || area > MAX_HA) throw conflict(`The outline covers ${area} ha. Walk the plot's boundary again; a plot is between ${MIN_HA} and ${MAX_HA} ha.`);

    const [cooperative] = await db.select().from(cooperatives).where(eq(cooperatives.id, contract.cooperativeId));
    if (payoutCountry(cooperative.country) && !insideCountry(input.ring, cooperative.country)) {
      throw conflict(`The outline isn't in ${payoutCountry(cooperative.country)!.name}, where this season pays farmers.`);
    }
    const known = await db.select({ id: inputDealers.id, kind: inputDealers.kind }).from(inputDealers);
    const local = Object.values(templateFor(contract.commodity).suppliers).map((s) => s.id);
    const nearby = known.filter((s) => local.includes(s.id));
    const pool = nearby.length ? nearby : known;
    const dealer = pool.find((s) => s.kind === 'INPUTS');
    if (!dealer) throw conflict('Register an input seller before adding farms');
    const suppliers: Suppliers = { INPUTS: dealer.id, ...Object.fromEntries(pool.filter((s) => s.kind !== 'INPUTS').map((s) => [s.kind, s.id])) };

    const check = await checkLand(input.ring);
    const farmerId = `farmer-${randomUUID().slice(0, 8)}`;
    const plotId = `plot-${randomUUID().slice(0, 8)}`;
    const terms = contract.terms ?? coffeeTerms(input.variety ?? 'arabica');
    const valueCents = termsValueCents(terms, input.ring);

    const contractRow = await db.transaction(async (tx) => {
      await tx.insert(farmers).values({ id: farmerId, cooperativeId: contract.cooperativeId, name: input.farmerName, paypalEmail: input.paypalEmail, paypalPayerId: payerId, createdAt: now });
      await tx.insert(plots).values({
        id: plotId,
        farmerId,
        dealerId: dealer.id,
        name: input.plotName,
        country: cooperative.country,
        commodity: contract.commodity,
        variety: contract.terms ? null : (input.variety ?? 'arabica'),
        ring: input.ring,
        areaHa: area,
        valueCents,
        eudrStatus: eudrStatus(check),
        eudrCheck: check,
        createdAt: now,
      });
      await tx.insert(milestones).values(plotMilestones({ contractId: contract.id, plotId, farmerId, suppliers, terms, valueCents }));
      const totalCents = contract.totalCents + valueCents;
      // Before funding the advance grows with the contract; after, the buyer's payment is fixed.
      const [row] = await tx
        .update(contracts)
        .set({ totalCents, ...(contract.state === 'DRAFT' && { advanceCents: Math.round((totalCents * terms.advancePercent) / 10_000) * 100 }) })
        .where(eq(contracts.id, contract.id))
        .returning();
      await appendLedger(tx, { kind: 'PLOT_REGISTERED', contractId: contract.id, plotId, farmerId, areaHa: area, valueCents, landCheck: eudrStatus(check) }, now);
      return row;
    });

    publish({ type: 'contract', contractId: contract.id, state: contractRow.state, escrowRemainingCents: contractRow.escrowRemainingCents });
    return { plotId, farmerId, areaHa: area, valueCents, landCheck: eudrStatus(check) };
  });
}
