import { randomUUID } from 'node:crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { contracts, milestones, plots } from '../db/schema';
import { notFound } from './errors';
import { appendLedger } from './ledger';

// Every visitor of the hosted app plays their own copy of the shared season, so one visitor's
// payments never show up as already done for the next. The copy keeps the farmers, suppliers
// and land checks, and starts unfunded with every stage waiting.
export async function startVisitorSeason(db: Db, templateId: string, now = Date.now()): Promise<string> {
  const [template] = await db.select().from(contracts).where(eq(contracts.id, templateId));
  if (!template) throw notFound(`Contract ${templateId}`);
  const stages = await db.select().from(milestones).where(eq(milestones.contractId, templateId)).orderBy(asc(milestones.id));
  const plotIds = [...new Set(stages.map((m) => m.plotId))];
  const farms = plotIds.length ? await db.select().from(plots).where(inArray(plots.id, plotIds)) : [];

  const suffix = randomUUID().slice(0, 8);
  const contractId = `season-${suffix}`;
  const plotId = (id: string) => `${id}-${suffix}`;

  await db.transaction(async (tx) => {
    await tx.insert(contracts).values({
      id: contractId,
      buyerId: template.buyerId,
      cooperativeId: template.cooperativeId,
      commodity: template.commodity,
      season: template.season,
      currency: template.currency,
      totalCents: template.totalCents,
      advanceCents: template.advanceCents,
      terms: template.terms,
      state: 'DRAFT',
      createdAt: now,
    });
    if (farms.length) await tx.insert(plots).values(farms.map((p) => ({ ...p, id: plotId(p.id) })));
    if (stages.length) {
      await tx.insert(milestones).values(
        stages.map((m) => ({
          id: `${plotId(m.plotId)}-${m.type.toLowerCase()}`,
          contractId,
          plotId: plotId(m.plotId),
          type: m.type,
          label: m.label,
          state: 'PENDING' as const,
          opensAt: m.opensAt,
          closesAt: m.closesAt,
          trancheCents: m.trancheCents,
          premiumCents: m.premiumCents,
          shares: m.shares,
          rule: m.rule,
        })),
      );
    }
    await appendLedger(tx, { kind: 'SEASON_STARTED', contractId, from: templateId, plots: farms.length }, now);
  });
  return contractId;
}

export const isVisitorSeason = (contractId: string) => contractId.startsWith('season-');
