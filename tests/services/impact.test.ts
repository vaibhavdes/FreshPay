import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import { contracts, milestones } from '@/lib/db/schema';
import { issueChallenge } from '@/lib/services/challenges';
import { seasonImpact } from '@/lib/services/impact';
import { submitClaim } from '@/lib/services/milestones';
import { freshDb, NOW, createSeason, stubPayPal } from '../helpers';

let db: Db;

beforeEach(async () => {
  db = await freshDb();
  await createSeason(db);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function pay(milestoneId: string) {
  const [milestone] = await db.select().from(milestones).where(eq(milestones.id, milestoneId));
  const challenge = await issueChallenge(db, milestone.plotId, milestone.type, NOW - 60_000);
  return submitClaim(db, {
    milestoneId,
    claimedMilestone: milestone.type,
    challengeId: challenge.id,
    challengeCode: challenge.code,
    gps: [75.771, 13.321],
    vision: { codeMatch: true, confidence: 0.94 },
    evidence: [{ kind: 'PHOTO', sha256: milestoneId.padEnd(64, 'a') }],
    now: NOW,
  });
}

describe('seasonImpact', () => {
  it('is empty before anything is paid', async () => {
    expect(await seasonImpact(db, 'contract-1')).toEqual({ paidCents: 0, supplierCents: 0, valuePercent: 0, medianMinutes: null });
  });

  it('adds up accepted payouts, the part paid to suppliers, and proof-to-payment time', async () => {
    // PayPal accepts each payout 90 seconds after the photo arrives.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW + 90_000);
    let n = 0;
    stubPayPal(() => Response.json({ batch_header: { payout_batch_id: `BATCH-${++n}`, batch_status: 'PENDING' } }, { status: 201 }));
    await pay('m-verified');
    await pay('m-inputs');

    const impact = await seasonImpact(db, 'contract-1');
    const [contract] = await db.select().from(contracts).where(eq(contracts.id, 'contract-1'));
    expect(impact).toMatchObject({ paidCents: 2500 + 4501, supplierCents: 2701 });
    expect(impact.valuePercent).toBeCloseTo((7001 / contract.totalCents) * 100);
    expect(impact.medianMinutes).toBe(1.5);
  });

  it('leaves out payouts PayPal refused', async () => {
    stubPayPal(() => Response.json({ name: 'INSUFFICIENT_FUNDS' }, { status: 422 }));
    await pay('m-verified');
    expect((await seasonImpact(db, 'contract-1')).paidCents).toBe(0);
  });
});
