import { existsSync, readFileSync } from 'node:fs';
import { db } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import * as seed from '@/lib/db/seed-data';
import { eudrStatus, type GeoCheck } from '@/lib/engine/eudr';
import { ADVANCE_PERCENT, plotMilestones } from '@/lib/season-terms';

const GEO_CHECKS = 'lib/db/geo-checks.json';
const placeholder = (id: string) => `${id}@agritranche.example`;

async function main() {
  const database = await db();
  // On the hosted demo the seed runs at every start, but only fills an empty database.
  if (process.argv.includes('--if-empty') && (await database.select().from(schema.contracts).limit(1)).length) {
    console.log('Database already seeded');
    return;
  }
  const now = Date.now();
  const geoChecks: Record<string, GeoCheck> = existsSync(GEO_CHECKS) ? JSON.parse(readFileSync(GEO_CHECKS, 'utf8')) : {};

  // Real sandbox accounts where we have them; the rest are unregistered emails, which PayPal
  // holds as UNCLAIMED payouts, a state the UI shows rather than hides.
  const emails: Record<string, string | undefined> = {
    [seed.buyer.id]: process.env.SANDBOX_BUYER_EMAIL,
    'farmer-lakshmi': process.env.SANDBOX_FARMER_EMAIL,
    'farmer-ravi': process.env.SANDBOX_FARMER_2_EMAIL,
    [seed.dealer.id]: process.env.SANDBOX_DEALER_EMAIL,
    [seed.supplierIds.LABOUR]: process.env.SANDBOX_LABOUR_EMAIL,
    [seed.supplierIds.MACHINERY]: process.env.SANDBOX_MACHINERY_EMAIL,
  };
  const email = (id: string) => emails[id] || placeholder(id);

  await database.transaction(async (tx) => {
    for (const table of [
      schema.disputes,
      schema.reconciliationRuns,
      schema.premiums,
      schema.agentReviews,
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
      schema.contracts,
      schema.plots,
      schema.inputDealers,
      schema.farmers,
      schema.cooperatives,
      schema.buyers,
    ]) {
      await tx.delete(table);
    }

    await tx.insert(schema.buyers).values({ ...seed.buyer, paypalEmail: email(seed.buyer.id), createdAt: now });
    await tx.insert(schema.cooperatives).values({ ...seed.cooperative, createdAt: now });
    await tx.insert(schema.farmers).values(seed.farmers.map((f) => ({ ...f, cooperativeId: seed.cooperative.id, paypalEmail: email(f.id), createdAt: now })));
    await tx.insert(schema.inputDealers).values(seed.suppliers.map((s) => ({ ...s, paypalEmail: email(s.id), createdAt: now })));

    await tx.insert(schema.plots).values(
      seed.plots.map((p) => ({
        id: p.id,
        farmerId: p.farmerId,
        dealerId: seed.dealer.id,
        name: p.name,
        country: 'IN',
        commodity: 'coffee',
        variety: p.variety,
        ring: p.ring,
        areaHa: seed.areaHa(p.ring),
        valueCents: seed.plotValueCents(p),
        eudrStatus: eudrStatus(geoChecks[p.id] ?? null),
        eudrCheck: geoChecks[p.id] ?? null,
        createdAt: now,
      })),
    );

    const totalCents = seed.plots.reduce((sum, p) => sum + seed.plotValueCents(p), 0);
    await tx.insert(schema.contracts).values({
      ...seed.contract,
      buyerId: seed.buyer.id,
      cooperativeId: seed.cooperative.id,
      totalCents,
      advanceCents: Math.round((totalCents * ADVANCE_PERCENT) / 10_000) * 100,
      state: 'DRAFT',
      createdAt: now,
    });

    await tx.insert(schema.milestones).values(
      seed.plots.flatMap((p) =>
        plotMilestones({ contractId: seed.contract.id, plotId: p.id, farmerId: p.farmerId, suppliers: seed.supplierIds, variety: p.variety, valueCents: seed.plotValueCents(p) }),
      ),
    );
  });

  const plots = await database.select().from(schema.plots);
  const [contract] = await database.select().from(schema.contracts);
  console.table(plots.map((p) => ({ plot: p.id, variety: p.variety, areaHa: p.areaHa, eudr: p.eudrStatus, lossHa: p.eudrCheck?.lossSince2021Ha ?? '-', scenario: seed.plots.find((s) => s.id === p.id)?.scenario })));
  console.log(`Contract ${contract.id}: total $${contract.totalCents / 100}, advance $${contract.advanceCents / 100}`);
  if (!Object.keys(geoChecks).length) console.log('No geo checks found: every plot is REVIEW until you run npm run prefetch:geo');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
