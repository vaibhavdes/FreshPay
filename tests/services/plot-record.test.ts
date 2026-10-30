import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { milestones } from '@/lib/db/schema';
import { issueChallenge } from '@/lib/services/challenges';
import { submitClaim } from '@/lib/services/milestones';
import { plotRecord } from '@/lib/services/plot-record';
import { freshDb, NOW, seed, stubPayPal } from '../helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('plotRecord', () => {
  it('ties each paid step to its evidence, its PayPal batch and its ledger receipts', async () => {
    const db = await freshDb();
    await seed(db);
    stubPayPal(() => Response.json({ batch_header: { payout_batch_id: 'BATCH-1' } }, { status: 201 }));
    const [verified] = await db.select().from(milestones).where(eq(milestones.id, 'm-verified'));
    const challenge = await issueChallenge(db, verified.plotId, verified.type, NOW - 60_000);
    await submitClaim(db, {
      milestoneId: 'm-verified',
      claimedMilestone: 'PLOT_VERIFIED',
      challengeId: challenge.id,
      challengeCode: challenge.code,
      gps: [75.771, 13.321],
      vision: { codeMatch: true, confidence: 0.94 },
      evidence: [{ kind: 'PHOTO', sha256: 'a'.repeat(64), oracle: { reading: { challengeCodeRead: challenge.code, confidence: 0.94 } } }],
      now: NOW,
    });

    const record = await plotRecord(db, 'plot-1', NOW);

    const [registered] = record.steps;
    expect(registered).toMatchObject({ type: 'PLOT_VERIFIED', state: 'RELEASED', payment: { batchId: 'BATCH-1', items: [{ payee: 'Lakshmi', cents: 2500 }] } });
    expect(registered.evidence[0].reading?.challengeCodeRead).toBe(challenge.code);
    expect(registered.payment?.receipts.map((r) => r.kind)).toEqual(['RELEASE_INTENT', 'RELEASE_RESULT']);
    expect(record.geojson.properties).toMatchObject({
      payments: [{ milestone: 'PLOT_VERIFIED', paypalId: 'BATCH-1', cents: 2500 }],
      evidence: [{ milestone: 'PLOT_VERIFIED', sha256: 'a'.repeat(64) }],
    });
  });
});
