import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import { milestones } from '@/lib/db/schema';
import type { BillRule } from '@/lib/engine/gate';
import { issueChallenge } from '@/lib/services/challenges';
import { submitClaim, type ClaimInput } from '@/lib/services/milestones';
import { DAY, freshDb, NOW, seed, stubPayPal } from '../helpers';

let db: Db;

const RULE: BillRule = { kind: 'BILL', lines: [{ kind: 'INPUTS', capCents: 5000, payeeId: 'dealer-1' }], labourCents: 1000, farmerId: 'farmer-1' };
const BILL = { kind: 'INPUTS' as const, cents: 3429, payeeId: 'dealer-1', issuer: 'Agro Inputs Pvt Ltd', number: 'AI-2291', date: '2026-11-01' };

beforeEach(async () => {
  db = await freshDb();
  await seed(db);
  await db.update(milestones).set({ rule: RULE, trancheCents: 6000 }).where(eq(milestones.id, 'm-inputs'));
  await db.insert(milestones).values({
    id: 'm-care',
    contractId: 'contract-1',
    plotId: 'plot-1',
    type: 'CROP_CARE',
    state: 'PENDING',
    opensAt: NOW - DAY,
    closesAt: NOW + 30 * DAY,
    trancheCents: 6000,
    shares: [],
    rule: RULE,
  });
  stubPayPal(() => Response.json({ batch_header: { payout_batch_id: `BATCH-${Math.random()}` } }, { status: 201 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function claim(milestoneId: string, overrides: Partial<ClaimInput> = {}): Promise<ClaimInput> {
  const [milestone] = await db.select().from(milestones).where(eq(milestones.id, milestoneId));
  const challenge = await issueChallenge(db, milestone.plotId, milestone.type, NOW - 60_000);
  return {
    milestoneId,
    claimedMilestone: milestone.type,
    challengeId: challenge.id,
    challengeCode: challenge.code,
    gps: [75.771, 13.321],
    vision: { codeMatch: true, confidence: 0.94 },
    evidence: [{ kind: 'PHOTO', sha256: `${milestoneId}`.padEnd(64, '0'), photoHash: 'ffff0000ffff0000' }],
    now: NOW,
    ...overrides,
  };
}

describe('evidence reused within a season', () => {
  it('pays a bill once and refuses it on a later stage', async () => {
    await submitClaim(db, await claim('m-verified', { evidence: [{ kind: 'PHOTO', sha256: 'v'.padEnd(64, '0'), photoHash: '00000000ffffffff' }] }));
    expect((await submitClaim(db, await claim('m-inputs', { bills: [BILL] }))).decision.kind).toBe('RELEASE');

    const again = await submitClaim(db, await claim('m-care', { bills: [BILL], evidence: [{ kind: 'PHOTO', sha256: 'c'.padEnd(64, '0'), photoHash: '0f0f0f0f0f0f0f0f' }] }));
    expect(again.decision).toMatchObject({ kind: 'REJECT', reasons: ['BILL_ALREADY_PAID'] });
  });

  it('holds a photo that matches one sent on another stage, and a bill naming someone else', async () => {
    await submitClaim(db, await claim('m-verified'));
    const reused = await submitClaim(db, await claim('m-inputs', { bills: [{ ...BILL, issuer: 'Sri Ganesh Traders' }], evidence: [{ kind: 'PHOTO', sha256: 'r'.padEnd(64, '0'), photoHash: 'ffff0000ffff0001' }] }));
    expect(reused.decision).toMatchObject({ kind: 'REVIEW', reasons: ['PHOTO_USED_BEFORE', 'BILL_ISSUER_MISMATCH'] });
  });
});
