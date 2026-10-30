import { createHmac, randomUUID } from 'node:crypto';
import type { Db } from '../db/client';
import { challenges } from '../db/schema';
import { DEFAULT_POLICY } from '../engine/gate';
import type { PlotMilestone } from '../engine/stateMachine';
import { env } from '../env';

// No 0/O, 1/I/L: the farmer writes this code on paper for the photo.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export type Challenge = typeof challenges.$inferSelect;

export function challengeCode(c: Pick<Challenge, 'id' | 'plotId' | 'milestoneType' | 'issuedAt'>, secret = env().CHALLENGE_SECRET): string {
  const mac = createHmac('sha256', secret).update(`${c.id}|${c.plotId}|${c.milestoneType}|${c.issuedAt}`).digest();
  return Array.from(mac.subarray(0, 6), (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

// A stored challenge only counts if its code still matches the server's signature.
export const isAuthentic = (c: Challenge) => c.code === challengeCode(c);

export async function issueChallenge(db: Db, plotId: string, milestoneType: PlotMilestone, now = Date.now()) {
  const challenge = { id: randomUUID(), plotId, milestoneType, issuedAt: now };
  const code = challengeCode(challenge);
  await db.insert(challenges).values({ ...challenge, code });
  return { id: challenge.id, code, issuedAt: now, expiresAt: now + DEFAULT_POLICY.challengeTtlMs };
}
