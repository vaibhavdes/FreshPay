import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { contracts, plots } from '../db/schema';

// Where the role switch and step rail land in a one-season demo: the season's contract, and the
// first farm whose land check passed (the one whose story runs end to end).
export async function demoEntry(db: Db) {
  const [contract] = await db.select({ id: contracts.id }).from(contracts).orderBy(asc(contracts.createdAt)).limit(1);
  const [farm] = await db.select({ id: plots.id }).from(plots).where(eq(plots.eudrStatus, 'PASS')).orderBy(asc(plots.id)).limit(1);
  return { contractId: contract?.id ?? null, farmId: farm?.id ?? null };
}
