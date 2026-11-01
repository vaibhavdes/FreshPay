import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import { billConfirmations, milestones } from '@/lib/db/schema';
import { issueChallenge } from '@/lib/services/challenges';
import { answerConfirmation, confirmation, sellerDeniedOnPlot } from '@/lib/services/confirmations';
import { submitClaim, type ClaimInput } from '@/lib/services/milestones';
import { freshDb, NOW, createSeason, stubPayPal } from '../helpers';

let db: Db;

beforeEach(async () => {
  db = await freshDb();
  await createSeason(db);
  await db
    .update(milestones)
    .set({ rule: { kind: 'BILL', lines: [{ kind: 'INPUTS', capCents: 2701, payeeId: 'dealer-1' }], labourCents: 1800, farmerId: 'farmer-1' } })
    .where(eq(milestones.id, 'm-inputs'));
  const [verified] = await db.select().from(milestones).where(eq(milestones.id, 'm-verified'));
  await db.insert(milestones).values({ ...verified, id: 'm-care', type: 'CROP_CARE', state: 'PENDING' });
  let n = 0;
  stubPayPal(() => Response.json({ batch_header: { payout_batch_id: `BATCH-${++n}`, batch_status: 'PENDING' } }, { status: 201 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function claim(milestoneId: string, overrides: Partial<ClaimInput> = {}) {
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
    ...overrides,
  });
}

describe('seller confirmation', () => {
  it('asks the seller after a bill is paid, and holds the farm when the seller denies it', async () => {
    await claim('m-verified');
    expect(await db.select().from(billConfirmations)).toHaveLength(0);

    await claim('m-inputs', { bills: [{ kind: 'INPUTS', cents: 2701 }] });
    const [ask] = await db.select().from(billConfirmations);
    expect(ask).toMatchObject({ milestoneId: 'm-inputs', payeeId: 'dealer-1', cents: 2701, status: 'WAITING' });
    expect((await confirmation(db, ask.id)).seller).toBeTruthy();

    expect(await answerConfirmation(db, ask.id, false)).toBe('DENIED');
    await expect(answerConfirmation(db, ask.id, true)).rejects.toThrow('already been answered');
    expect(await sellerDeniedOnPlot(db, 'plot-1')).toBe(true);

    expect((await claim('m-care')).decision).toMatchObject({ kind: 'REVIEW', reasons: ['SELLER_DENIED_BILL'] });
  });

  it('records a confirmed bill without holding anything', async () => {
    await claim('m-verified');
    await claim('m-inputs', { bills: [{ kind: 'INPUTS', cents: 2701 }] });
    const [ask] = await db.select().from(billConfirmations);
    expect(await answerConfirmation(db, ask.id, true)).toBe('CONFIRMED');
    expect(await sellerDeniedOnPlot(db, 'plot-1')).toBe(false);
    await expect(confirmation(db, 'missing')).rejects.toThrow();
  });
});
