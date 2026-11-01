import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import { challenges, contracts, farmers, ledgerReceipts, milestones, payoutItems, paypalOps, plots } from '@/lib/db/schema';
import { issueChallenge } from '@/lib/services/challenges';
import { verifyLedger } from '@/lib/services/ledger';
import { approveHeldClaim, refuseHeldClaim, submitClaim, type ClaimInput } from '@/lib/services/milestones';
import { freshDb, NOW, seed, stubPayPal } from '../helpers';

const PLOT_CENTRE = [75.771, 13.321] as const;

let db: Db;

beforeEach(async () => {
  db = await freshDb();
  await seed(db);
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
    gps: PLOT_CENTRE,
    vision: { codeMatch: true, confidence: 0.94 },
    evidence: [{ kind: 'PHOTO', sha256: 'a'.repeat(64) }],
    now: NOW,
    ...overrides,
  };
}

const payoutBatch = (id: string) => Response.json({ batch_header: { payout_batch_id: id, batch_status: 'PENDING' } }, { status: 201 });

describe('submitClaim', () => {
  it('pays verified milestones in order and keeps the books balanced', async () => {
    const calls = stubPayPal(() => payoutBatch(`BATCH-${calls.length}`));

    const verified = await submitClaim(db, await claim('m-verified'));
    expect(verified).toMatchObject({ decision: { kind: 'RELEASE' }, payoutBatchId: 'BATCH-1' });

    const inputs = await submitClaim(db, await claim('m-inputs'));
    expect(inputs).toMatchObject({ decision: { kind: 'RELEASE', payouts: [{ id: 'dealer-1', cents: 2701 }, { id: 'farmer-1', cents: 1800 }] } });

    const batch = calls[1].body as { sender_batch_header: { sender_batch_id: string }; items: { amount: { value: string }; receiver: string }[] };
    expect(batch.items.map((i) => [i.receiver, i.amount.value])).toEqual([
      ['dealer@example.com', '27.01'],
      ['farmer1@example.com', '18.00'],
    ]);
    expect(calls[1].headers['PayPal-Request-Id']).toBe(batch.sender_batch_header.sender_batch_id);

    const [contract] = await db.select().from(contracts).where(eq(contracts.id, 'contract-1'));
    expect(contract).toMatchObject({ state: 'ACTIVE', escrowRemainingCents: 200_000 - 2500 - 4501 });
    expect(await db.select().from(payoutItems)).toHaveLength(3);
    expect(await verifyLedger(db)).toEqual({ ok: true });
    expect((await db.select().from(ledgerReceipts)).map((r) => r.payload.kind)).toEqual([
      'RELEASE_INTENT',
      'RELEASE_RESULT',
      'RELEASE_INTENT',
      'RELEASE_RESULT',
    ]);
  });

  it('pays a farmer who signed in with PayPal at their payer id', async () => {
    const calls = stubPayPal(() => payoutBatch('BATCH-1'));
    await db.update(farmers).set({ paypalPayerId: 'PAYERID123' }).where(eq(farmers.id, 'farmer-1'));
    await submitClaim(db, await claim('m-verified'));

    const batch = calls[0].body as { items: { recipient_type: string; receiver: string }[] };
    expect(batch.items).toMatchObject([{ recipient_type: 'PAYPAL_ID', receiver: 'PAYERID123' }]);
  });

  it('never pays the same milestone twice', async () => {
    const calls = stubPayPal(() => payoutBatch('BATCH-1'));
    await submitClaim(db, await claim('m-verified'));

    const again = await submitClaim(db, await claim('m-verified'));
    expect(again.decision.kind).toBe('DEDUPED');
    expect(calls).toHaveLength(1);
  });

  it('holds the money when the gate rejects the claim', async () => {
    const calls = stubPayPal(() => payoutBatch('BATCH-1'));
    const result = await submitClaim(db, await claim('m-inputs'));

    expect(result.decision).toMatchObject({ kind: 'REJECT', reasons: ['MILESTONE_OUT_OF_ORDER'] });
    expect(calls).toHaveLength(0);
  });

  it('rejects a claim with the wrong challenge code', async () => {
    stubPayPal(() => payoutBatch('BATCH-1'));
    const result = await submitClaim(db, await claim('m-verified', { challengeCode: 'ZZZZZZ' }));
    expect(result.decision).toMatchObject({ kind: 'REJECT', reasons: ['CHALLENGE_MISMATCH'] });
  });

  it('ignores a challenge whose stored code no longer matches its signature', async () => {
    stubPayPal(() => payoutBatch('BATCH-1'));
    const input = await claim('m-verified', { challengeCode: 'ZZZZZZ' });
    await db.update(challenges).set({ code: 'ZZZZZZ' }).where(eq(challenges.id, input.challengeId));

    const result = await submitClaim(db, input);
    expect(result.decision).toMatchObject({ kind: 'REJECT', reasons: ['CHALLENGE_MISSING'] });
  });

  it('sends low-confidence evidence to human review', async () => {
    stubPayPal(() => payoutBatch('BATCH-1'));
    const result = await submitClaim(db, await claim('m-verified', { vision: { codeMatch: true, confidence: 0.4 } }));

    expect(result.decision).toMatchObject({ kind: 'REVIEW', reasons: ['LOW_CONFIDENCE'] });
    const [milestone] = await db.select().from(milestones).where(eq(milestones.id, 'm-verified'));
    expect(milestone.state).toBe('REVIEW');
  });

  it('records a failed payout and retries it with the same request id', async () => {
    let fail = true;
    const calls = stubPayPal(() =>
      fail ? Response.json({ name: 'INSUFFICIENT_FUNDS', message: 'Sender does not have sufficient funds' }, { status: 422 }) : payoutBatch('BATCH-OK'),
    );

    const failed = await submitClaim(db, await claim('m-verified'));
    expect(failed.error).toMatchObject({ route: 'FIX_THE_CODE', issue: 'INSUFFICIENT_FUNDS' });
    const [op] = await db.select().from(paypalOps);
    expect(op).toMatchObject({ status: 'FAILED', errorIssue: 'INSUFFICIENT_FUNDS', attempts: 1 });

    const [refunded] = await db.select().from(contracts).where(eq(contracts.id, 'contract-1'));
    expect(refunded.escrowRemainingCents).toBe(200_000);

    fail = false;
    const retried = await submitClaim(db, await claim('m-verified'));
    expect(retried.payoutBatchId).toBe('BATCH-OK');
    expect(calls[1].headers['PayPal-Request-Id']).toBe(calls[0].headers['PayPal-Request-Id']);
    expect(await db.select().from(payoutItems)).toHaveLength(1);
    const [contract] = await db.select().from(contracts).where(eq(contracts.id, 'contract-1'));
    expect(contract.escrowRemainingCents).toBe(200_000 - 2500);
    expect(await verifyLedger(db)).toEqual({ ok: true });
  });

  it('lets only one of two racing payouts spend the last of the escrow', async () => {
    let batch = 0;
    stubPayPal(() => payoutBatch(`BATCH-${++batch}`));
    const [plot] = await db.select().from(plots).where(eq(plots.id, 'plot-1'));
    await db.insert(plots).values({ ...plot, id: 'plot-2' });
    const [verified] = await db.select().from(milestones).where(eq(milestones.id, 'm-verified'));
    await db.insert(milestones).values({ ...verified, id: 'm-verified-2', plotId: 'plot-2' });
    await db.update(contracts).set({ escrowRemainingCents: 3000 }).where(eq(contracts.id, 'contract-1'));

    const inputs = [await claim('m-verified'), await claim('m-verified-2')];
    const results = await Promise.all(inputs.map((input) => submitClaim(db, input)));

    expect(results.map((r) => r.decision.kind).sort()).toEqual(['REJECT', 'RELEASE']);
    expect(results.find((r) => r.decision.kind === 'REJECT')?.decision).toMatchObject({ reasons: ['ESCROW_EXCEEDED'] });
    const [contract] = await db.select().from(contracts).where(eq(contracts.id, 'contract-1'));
    expect(contract.escrowRemainingCents).toBe(500);
  });

  it('finishes the books when a payout went through but was never recorded', async () => {
    const calls = stubPayPal(() => payoutBatch('BATCH-1'));
    await submitClaim(db, await claim('m-verified'));
    await db.update(milestones).set({ state: 'PENDING' }).where(eq(milestones.id, 'm-verified'));

    const again = await submitClaim(db, await claim('m-verified'));

    expect(again).toMatchObject({ decision: { kind: 'DEDUPED' }, payoutBatchId: 'BATCH-1' });
    expect(calls).toHaveLength(1);
    const [milestone] = await db.select().from(milestones).where(eq(milestones.id, 'm-verified'));
    expect(milestone.state).toBe('RELEASED');
    const [contract] = await db.select().from(contracts).where(eq(contracts.id, 'contract-1'));
    expect(contract.escrowRemainingCents).toBe(200_000 - 2500);
  });
});

describe('cooperative review', () => {
  async function heldClaim() {
    stubPayPal(() => payoutBatch('BATCH-REVIEWED'));
    const result = await submitClaim(db, await claim('m-verified', { vision: { codeMatch: true, confidence: 0.4 } }));
    expect(result.decision.kind).toBe('REVIEW');
  }

  it('pays a held claim when the officer approves it, and records who approved', async () => {
    await heldClaim();
    const approved = await approveHeldClaim(db, { milestoneId: 'm-verified', reviewer: 'Field officer', note: 'Code is legible', now: NOW });

    expect(approved).toMatchObject({ decision: { kind: 'RELEASE' }, payoutBatchId: 'BATCH-REVIEWED' });
    const [milestone] = await db.select().from(milestones).where(eq(milestones.id, 'm-verified'));
    expect(milestone.state).toBe('RELEASED');
    expect((await db.select().from(ledgerReceipts)).map((r) => r.payload.kind)).toEqual(['REVIEW_APPROVED', 'RELEASE_INTENT', 'RELEASE_RESULT']);
    expect(await verifyLedger(db)).toEqual({ ok: true });
  });

  it('sends a refused claim back to the farmer', async () => {
    await heldClaim();
    const refused = await refuseHeldClaim(db, { milestoneId: 'm-verified', reviewer: 'Field officer', now: NOW });

    expect(refused.decision).toMatchObject({ kind: 'REJECT', reasons: ['REVIEWER_REFUSED'] });
    const [milestone] = await db.select().from(milestones).where(eq(milestones.id, 'm-verified'));
    expect(milestone.state).toBe('PENDING');
  });

  it('will not approve or refuse a claim that is not held', async () => {
    stubPayPal(() => payoutBatch('BATCH-1'));
    expect((await approveHeldClaim(db, { milestoneId: 'm-verified', reviewer: 'Field officer', now: NOW })).decision).toMatchObject({
      kind: 'REJECT',
      reasons: ['NOT_HELD_FOR_REVIEW'],
    });
    await expect(refuseHeldClaim(db, { milestoneId: 'm-verified', reviewer: 'Field officer' })).rejects.toThrow('not waiting for a review');
  });
});
