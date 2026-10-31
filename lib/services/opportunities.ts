import { randomUUID } from 'node:crypto';
import { desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { buyers, contracts, cooperatives, farmers, milestones, opportunities, plots } from '../db/schema';
import { PAYOUT_COUNTRIES } from '../countries';
import { cropTemplate, stagesPercent } from '../programmes';
import type { SeasonTerms } from '../season-terms';
import { conflict, notFound } from './errors';
import { appendLedger } from './ledger';

export const PostOpportunity = z.object({
  company: z.string().trim().min(2).max(80),
  companyCountry: z.string().trim().min(2).max(60),
  country: z.enum(PAYOUT_COUNTRIES.map((c) => c.code) as [string, ...string[]]),
  region: z.string().trim().min(2).max(80),
  templateId: z.string().min(1),
  hectaresWanted: z.number().min(0.5).max(100_000),
  yieldKgPerHa: z.number().int().min(1).max(200_000),
  priceCentsPerKg: z.number().int().min(1).max(100_000),
  advancePercent: z.number().int().min(10).max(80),
  applyBy: z.iso.date(),
});
export type PostOpportunity = z.infer<typeof PostOpportunity>;

const seasonLabel = (terms: SeasonTerms) => {
  const dates = Object.values(terms.stages).flatMap((s) => [s.opensAt, s.closesAt]).sort();
  const [first, last] = [dates[0].slice(0, 4), dates.at(-1)!.slice(2, 4)];
  return first.slice(2) === last ? first : `${first}-${last}`;
};

// A company posts a season from a crop template with its own yield, price and advance. The
// contract starts empty: it grows as farmers join, and is funded with PayPal like any other.
export async function postOpportunity(db: Db, input: PostOpportunity, buyerEmail: string, now = Date.now()) {
  const template = cropTemplate(input.templateId);
  if (!template) throw notFound(`Crop template ${input.templateId}`);
  const terms: SeasonTerms = { ...template.terms, yieldKgPerHa: input.yieldKgPerHa, priceCentsPerKg: input.priceCentsPerKg, advancePercent: input.advancePercent };
  const staged = stagesPercent(terms);
  if (staged > input.advancePercent) throw conflict(`The stages pay up to ${staged}% of the crop value, more than the ${input.advancePercent}% paid ahead. Raise the advance.`);

  const key = randomUUID().slice(0, 8);
  const ids = { buyer: `buyer-${key}`, cooperative: `coop-${key}`, contract: `contract-${key}`, opportunity: `opp-${key}` };
  const title = `${template.crop} from ${input.region}`;

  await db.transaction(async (tx) => {
    await tx.insert(buyers).values({ id: ids.buyer, name: input.company, country: input.companyCountry, paypalEmail: buyerEmail, createdAt: now });
    await tx.insert(cooperatives).values({ id: ids.cooperative, name: `${input.region} growers`, region: input.region, country: input.country, createdAt: now });
    await tx.insert(contracts).values({
      id: ids.contract,
      buyerId: ids.buyer,
      cooperativeId: ids.cooperative,
      commodity: template.commodity,
      season: seasonLabel(terms),
      currency: 'USD',
      totalCents: 0,
      advanceCents: 0,
      state: 'DRAFT',
      terms,
      createdAt: now,
    });
    await tx.insert(opportunities).values({ id: ids.opportunity, contractId: ids.contract, title, templateId: template.id, country: input.country, region: input.region, hectaresWanted: input.hectaresWanted, applyBy: input.applyBy, createdAt: now });
    await appendLedger(tx, { kind: 'OPPORTUNITY_POSTED', opportunityId: ids.opportunity, contractId: ids.contract, company: input.company, crop: template.crop, terms }, now);
  });
  return { id: ids.opportunity, contractId: ids.contract };
}

// The board: every opportunity with its company, terms and how much land has joined so far.
export async function listOpportunities(db: Db) {
  const rows = await db
    .select({ opportunity: opportunities, contract: contracts, company: buyers.name })
    .from(opportunities)
    .innerJoin(contracts, eq(opportunities.contractId, contracts.id))
    .innerJoin(buyers, eq(contracts.buyerId, buyers.id))
    .orderBy(desc(opportunities.createdAt));
  const joined = await farmsOf(db, rows.map((r) => r.contract.id));
  return rows.map(({ opportunity, contract, company }) => {
    const farms = joined.filter((f) => f.contractId === contract.id);
    return { ...opportunity, company, contract, terms: contract.terms!, farms: farms.length, hectaresJoined: Math.round(farms.reduce((sum, f) => sum + f.areaHa, 0) * 100) / 100 };
  });
}

export async function opportunity(db: Db, id: string) {
  const [row] = await db
    .select({ opportunity: opportunities, contract: contracts, company: buyers.name })
    .from(opportunities)
    .innerJoin(contracts, eq(opportunities.contractId, contracts.id))
    .innerJoin(buyers, eq(contracts.buyerId, buyers.id))
    .where(eq(opportunities.id, id));
  if (!row) throw notFound(`Opportunity ${id}`);
  const farms = await farmsOf(db, [row.contract.id]);
  return { ...row.opportunity, company: row.company, contract: row.contract, terms: row.contract.terms!, farms, hectaresJoined: Math.round(farms.reduce((sum, f) => sum + f.areaHa, 0) * 100) / 100 };
}

async function farmsOf(db: Db, contractIds: string[]) {
  if (!contractIds.length) return [];
  return db
    .selectDistinct({ contractId: milestones.contractId, id: plots.id, name: plots.name, farmer: farmers.name, areaHa: plots.areaHa, landCheck: plots.eudrStatus, valueCents: plots.valueCents })
    .from(milestones)
    .innerJoin(plots, eq(milestones.plotId, plots.id))
    .innerJoin(farmers, eq(plots.farmerId, farmers.id))
    .where(inArray(milestones.contractId, contractIds));
}
