import type { Db } from '../db/client';
import { hasSnapshot, restoreSnapshot } from '../db/snapshot';
import { env } from '../env';

// The hosted demo is open to everyone, so a visitor can approve a held claim or answer a seller's
// link in the recorded seasons. Once nobody has changed anything for a while, the recorded
// seasons are put back, so the next visitor finds the same held claims and waiting links.
export const IDLE_MS = 45 * 60_000;

const holder = globalThis as typeof globalThis & { farmproofLastWrite?: number };

export function noteWrite(now = Date.now()) {
  holder.farmproofLastWrite = now;
}

export async function restoreIfIdle(db: Db, now = Date.now(), restore: (db: Db) => Promise<void> = restoreSnapshot): Promise<boolean> {
  const last = holder.farmproofLastWrite;
  if (!env().SANDBOX_TOOLS || !hasSnapshot() || last === undefined || now - last < IDLE_MS) return false;
  holder.farmproofLastWrite = undefined;
  await restore(db);
  console.log('Recorded seasons restored after visitor changes');
  return true;
}
