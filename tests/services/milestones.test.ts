import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import { challenges, contracts, ledgerReceipts, milestones, payoutItems, paypalOps } from '@/lib/db/schema';
import { issueChallenge } from '@/lib/services/challenges';
import { verifyLedger } from '@/lib/services/ledger';
import { submitClaim, type ClaimInput } from '@/lib/services/milestones';
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

    fail = false;
    const retried = await submitClaim(db, await claim('m-verified'));
    expect(retried.payoutBatchId).toBe('BATCH-OK');
    expect(calls[1].headers['PayPal-Request-Id']).toBe(calls[0].headers['PayPal-Request-Id']);
    expect(await db.select().from(payoutItems)).toHaveLength(1);
    expect(await verifyLedger(db)).toEqual({ ok: true });
  });
});
