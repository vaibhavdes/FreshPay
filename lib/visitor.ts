import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import type { Db } from './db/client';
import { contracts } from './db/schema';

export const SEASON_COOKIE = 'fp_season';

// The season this browser is playing, if it started one and it still exists.
export async function visitorSeason(db: Db): Promise<string | null> {
  const id = (await cookies()).get(SEASON_COOKIE)?.value;
  if (!id) return null;
  const [row] = await db.select({ id: contracts.id }).from(contracts).where(eq(contracts.id, id));
  return row?.id ?? null;
}
