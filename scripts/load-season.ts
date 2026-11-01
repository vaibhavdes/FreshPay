import { existsSync, readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import * as season from '@/lib/db/season-data';
import { eudrStatus, type GeoCheck } from '@/lib/engine/eudr';
import { ADVANCE_PERCENT, coffeeTerms, plotMilestones } from '@/lib/season-terms';

const GEO_CHECKS = 'lib/db/geo-checks.json';
const placeholder = (id: string) => `${id}@farmproof.test`;

async function main() {
  const database = await db();
  const totalCents = season.plots.reduce((sum, p) => sum + season.plotValueCents(p), 0);
  // On the hosted app this runs at every start. It loads the season into an empty database, or
  // again when the season's figures have changed since it was loaded.
  if (process.argv.includes('--if-empty')) {
    const [loaded] = await database.select({ totalCents: schema.contracts.totalCents }).from(schema.contracts).where(eq(schema.contracts.id, season.contract.id));
    if (loaded?.totalCents === totalCents) {
      console.log('The season is already loaded');
      return;
    }
  }
  const now = Date.now();
  const geoChecks: Record<string, GeoCheck> = existsSync(GEO_CHECKS) ? JSON.parse(readFileSync(GEO_CHECKS, 'utf8')) : {};

  // Real sandbox accounts where we have them; the rest are unregistered emails, which PayPal
  // holds as UNCLAIMED payouts, a state the UI shows rather than hides.
  const emails: Record<string, string | undefined> = {
    [season.buyer.id]: process.env.SANDBOX_BUYER_EMAIL,
    'farmer-lakshmi': process.env.SANDBOX_FARMER_EMAIL,
    'farmer-ravi': process.env.SANDBOX_FARMER_2_EMAIL,
    [season.dealer.id]: process.env.SANDBOX_DEALER_EMAIL,
    [season.supplierIds.LABOUR]: process.env.SANDBOX_LABOUR_EMAIL,
    [season.supplierIds.MACHINERY]: process.env.SANDBOX_MACHINERY_EMAIL,
  };
  const email = (id: string) => emails[id] || placeholder(id);

  await database.transaction(async (tx) => {
    for (const table of [
      schema.disputes,
      schema.reconciliationRuns,
      schema.premiums,
      schema.agentReviews,
      schema.billFingerprints,
      schema.evidence,
      schema.evidenceFiles,
      schema.challenges,
      schema.payoutItems,
      schema.paypalOps,
      schema.webhookEvents,
      schema.ledgerReceipts,
      schema.eudrRecords,
      schema.mandates,
      schema.milestones,
      schema.opportunities,
      schema.contracts,
      schema.plots,
      schema.inputDealers,
      schema.farmers,
      schema.cooperatives,
      schema.buyers,
    ]) {
      await tx.delete(table);
    }

    await tx.insert(schema.buyers).values({ ...season.buyer, paypalEmail: email(season.buyer.id), createdAt: now });
    await tx.insert(schema.cooperatives).values({ ...season.cooperative, createdAt: now });
    await tx.insert(schema.farmers).values(season.farmers.map((f) => ({ ...f, cooperativeId: season.cooperative.id, paypalEmail: email(f.id), createdAt: now })));
    await tx.insert(schema.inputDealers).values(season.suppliers.map((s) => ({ ...s, paypalEmail: email(s.id), createdAt: now })));

    await tx.insert(schema.plots).values(
      season.plots.map((p) => ({
        id: p.id,
        farmerId: p.farmerId,
        dealerId: season.dealer.id,
        name: p.name,
        country: 'IN',
        commodity: 'coffee',
        variety: p.variety,
        ring: p.ring,
        areaHa: season.areaHa(p.ring),
        valueCents: season.plotValueCents(p),
        eudrStatus: eudrStatus(geoChecks[p.id] ?? null),
        eudrCheck: geoChecks[p.id] ?? null,
        createdAt: now,
      })),
    );

    await tx.insert(schema.contracts).values({
      ...season.contract,
      buyerId: season.buyer.id,
      cooperativeId: season.cooperative.id,
      totalCents,
      advanceCents: Math.round((totalCents * ADVANCE_PERCENT) / 10_000) * 100,
      state: 'DRAFT',
      createdAt: now,
    });

    await tx.insert(schema.milestones).values(
      season.plots.flatMap((p) =>
        plotMilestones({ contractId: season.contract.id, plotId: p.id, farmerId: p.farmerId, suppliers: season.supplierIds, terms: coffeeTerms(p.variety), valueCents: season.plotValueCents(p) }),
      ),
    );
  });

  const plots = await database.select().from(schema.plots);
  const [contract] = await database.select().from(schema.contracts);
  console.table(plots.map((p) => ({ plot: p.id, variety: p.variety, areaHa: p.areaHa, eudr: p.eudrStatus, lossHa: p.eudrCheck?.lossSince2021Ha ?? '-', scenario: season.plots.find((s) => s.id === p.id)?.scenario })));
  console.log(`Contract ${contract.id}: total $${contract.totalCents / 100}, advance $${contract.advanceCents / 100}`);
  if (!Object.keys(geoChecks).length) console.log('No geo checks found: every plot is REVIEW until you run npm run prefetch:geo');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
