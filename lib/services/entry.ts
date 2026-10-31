import { and, asc, eq } from 'drizzle-orm';
import { contract as exampleSeason } from '../db/seed-data';
import type { Db } from '../db/client';
import { contracts, milestones, plots } from '../db/schema';

export const EXAMPLE_SEASON_ID = exampleSeason.id;

// Where the role switch and step rail land: the visitor's own season if they started one,
// otherwise the example season, and in it the first farm whose land check passed (the one whose
// story runs end to end).
export async function seasonFor(db: Db, seasonId?: string | null): Promise<string | null> {
  if (seasonId) return seasonId;
  const [example] = await db.select({ id: contracts.id }).from(contracts).where(eq(contracts.id, EXAMPLE_SEASON_ID));
  if (example) return example.id;
  const [first] = await db.select({ id: contracts.id }).from(contracts).orderBy(asc(contracts.createdAt)).limit(1);
  return first?.id ?? null;
}

export async function demoEntry(db: Db, seasonId?: string | null) {
  const contractId = await seasonFor(db, seasonId);
  const [farm] = contractId
    ? await db
        .selectDistinct({ id: plots.id })
        .from(plots)
        .innerJoin(milestones, eq(milestones.plotId, plots.id))
        .where(and(eq(milestones.contractId, contractId), eq(plots.eudrStatus, 'PASS')))
        .orderBy(asc(plots.id))
        .limit(1)
    : [];
  return { contractId, farmId: farm?.id ?? null };
}
