import { and, asc, eq } from 'drizzle-orm';
import { contract as sharedSeason } from '../db/season-data';
import type { Db } from '../db/client';
import { contracts, milestones, plots } from '../db/schema';

export const SHARED_SEASON_ID = sharedSeason.id;

// Where the role switch and step rail land: the visitor's own season if they started one,
// otherwise the shared season, and in it the first farm whose land check passed (the one whose
// story runs end to end).
export async function seasonFor(db: Db, seasonId?: string | null): Promise<string | null> {
  if (seasonId) return seasonId;
  const [shared] = await db.select({ id: contracts.id }).from(contracts).where(eq(contracts.id, SHARED_SEASON_ID));
  if (shared) return shared.id;
  const [first] = await db.select({ id: contracts.id }).from(contracts).orderBy(asc(contracts.createdAt)).limit(1);
  return first?.id ?? null;
}

export async function seasonEntry(db: Db, seasonId?: string | null) {
  const contractId = await seasonFor(db, seasonId);
  const [farm] = contractId
    ? await db
        .selectDistinct({ id: plots.id })
        .from(plots)
        .innerJoin(milestones, eq(milestones.plotId, plots.id))
        .where(and(eq(milestones.contractId, contractId), eq(plots.eudrStatus, 'PASS')))
        .orderBy(asc(plots.createdAt), asc(plots.id))
        .limit(1)
    : [];
  return { contractId, farmId: farm?.id ?? null };
}
