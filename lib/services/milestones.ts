import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { challenges, contracts, evidence, milestones, paypalOps, plots } from '../db/schema';
import { evaluateApproval, evaluateRelease, releaseKey, type GateDecision } from '../engine/gate';
import type { LngLat } from '../engine/geo';
import { PLOT_MILESTONES, transition, type PlotMilestone } from '../engine/stateMachine';
import { env } from '../env';
import { publish } from '../events';
import type { RoutedError } from '../paypal-errors';
import { isAuthentic } from './challenges';
import { conflict, notFound } from './errors';
import { appendLedger } from './ledger';
import { PayPalOpFailed } from './ops';
import { sendPayoutBatch } from './payouts';
import { accrueForVerifiedPlot } from './premium';

export type ClaimInput = {
  milestoneId: string;
  claimedMilestone: PlotMilestone;
  challengeId: string;
  challengeCode: string;
  gps: LngLat;
  vision: { codeMatch: boolean; confidence: number } | null;
  evidence: { kind: 'PHOTO' | 'VOICE' | 'WEIGHT_SLIP'; sha256: string; oracle?: Record<string, unknown> }[];
  now?: number;
};

export type ClaimResult = { decision: GateDecision; payoutBatchId?: string; error?: RoutedError };

type Milestone = typeof milestones.$inferSelect;
type Contract = typeof contracts.$inferSelect;
type Plot = typeof plots.$inferSelect;
type Release = Extract<GateDecision, { kind: 'RELEASE' }>;

async function release(db: Db, milestone: Milestone, contract: Contract, plot: Plot, decision: Release, now: number): Promise<ClaimResult> {
  const { key, payouts } = decision;
  await appendLedger(db, { kind: 'RELEASE_INTENT', key, milestoneId: milestone.id, payouts }, now);

  let batchId: string;
  try {
    batchId = await sendPayoutBatch(db, { key, payouts, note: `${milestone.type} verified for ${plot.name}`, now });
  } catch (error) {
    if (!(error instanceof PayPalOpFailed)) throw error;
    await appendLedger(db, { kind: 'RELEASE_FAILED', key, opId: error.op.id, route: error.routed.route, issue: error.routed.issue }, now);
    return { decision, error: error.routed };
  }

  const settled = await db.transaction(async (tx) => {
    await tx.update(milestones).set({ state: 'RELEASED', decision, decidedAt: now }).where(eq(milestones.id, milestone.id));
    const [row] = await tx
      .update(contracts)
      .set({
        escrowRemainingCents: contract.escrowRemainingCents - milestone.trancheCents,
        state: contract.state === 'FUNDED' ? transition('FUNDED', 'ACTIVATE') : contract.state,
      })
      .where(eq(contracts.id, contract.id))
      .returning();
    await appendLedger(tx, { kind: 'RELEASE_RESULT', key, payoutBatchId: batchId }, now);
    if (milestone.type === 'PLOT_VERIFIED') await accrueForVerifiedPlot(tx, { contractId: contract.id, plotId: plot.id, farmerId: plot.farmerId }, now);
    return row;
  });

  publish({ type: 'milestone', milestoneId: milestone.id, state: 'RELEASED' });
  publish({ type: 'contract', contractId: contract.id, state: settled.state, escrowRemainingCents: settled.escrowRemainingCents });
  return { decision, payoutBatchId: batchId };
}

export async function submitClaim(db: Db, input: ClaimInput): Promise<ClaimResult> {
  const now = input.now ?? Date.now();

  const [milestone] = await db.select().from(milestones).where(eq(milestones.id, input.milestoneId));
  if (!milestone) throw notFound(`Milestone ${input.milestoneId}`);
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, milestone.contractId));
  const [plot] = await db.select().from(plots).where(eq(plots.id, milestone.plotId));

  const released = await db
    .select({ type: milestones.type })
    .from(milestones)
    .where(and(eq(milestones.contractId, contract.id), eq(milestones.plotId, plot.id), eq(milestones.state, 'RELEASED')));
  const completedMilestones = PLOT_MILESTONES.filter((m) => released.some((r) => r.type === m));

  const [challenge] = await db
    .select()
    .from(challenges)
    .where(and(eq(challenges.id, input.challengeId), eq(challenges.plotId, plot.id), eq(challenges.milestoneType, milestone.type)));

  const key = releaseKey(contract.id, plot.id, milestone.type, milestone.version);
  const [completedOp] = await db
    .select({ id: paypalOps.id })
    .from(paypalOps)
    .where(and(eq(paypalOps.key, key), eq(paypalOps.status, 'COMPLETED')));

  const decision = evaluateRelease({
    paypalEnv: env().PAYPAL_ENV,
    now,
    contract: { id: contract.id, state: contract.state, escrowRemainingCents: contract.escrowRemainingCents },
    plot: { id: plot.id, ring: plot.ring, eudrStatus: plot.eudrStatus, completedMilestones },
    milestone: {
      type: milestone.type,
      version: milestone.version,
      opensAt: milestone.opensAt,
      closesAt: milestone.closesAt,
      trancheCents: milestone.trancheCents,
      shares: milestone.shares,
    },
    claim: { milestone: input.claimedMilestone, gps: input.gps, challengeCode: input.challengeCode },
    challenge: challenge && isAuthentic(challenge) ? challenge : null,
    vision: input.vision,
    findCompletedReceipt: (k) => (k === key ? completedOp?.id : undefined),
  });

  if (decision.kind === 'DEDUPED') return { decision };

  if (challenge && challenge.usedAt === null && challenge.code === input.challengeCode) {
    await db.update(challenges).set({ usedAt: now }).where(eq(challenges.id, challenge.id));
  }
  if (input.evidence.length) {
    await db.insert(evidence).values(
      input.evidence.map((e) => ({
        id: randomUUID(),
        milestoneId: milestone.id,
        challengeId: challenge?.id ?? null,
        kind: e.kind,
        sha256: e.sha256,
        gps: input.gps,
        oracle: e.oracle ?? null,
        createdAt: now,
      })),
    );
  }

  if (decision.kind === 'RELEASE') return release(db, milestone, contract, plot, decision, now);

  const state = decision.kind === 'REVIEW' ? 'REVIEW' : 'PENDING';
  await db.update(milestones).set({ state, decision, decidedAt: now }).where(eq(milestones.id, milestone.id));
  publish({ type: 'milestone', milestoneId: milestone.id, state });
  return { decision };
}

async function loadForReview(db: Db, milestoneId: string) {
  const [milestone] = await db.select().from(milestones).where(eq(milestones.id, milestoneId));
  if (!milestone) throw notFound(`Milestone ${milestoneId}`);
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, milestone.contractId));
  const [plot] = await db.select().from(plots).where(eq(plots.id, milestone.plotId));
  return { milestone, contract, plot, key: releaseKey(contract.id, plot.id, milestone.type, milestone.version) };
}

export type ReviewInput = { milestoneId: string; reviewer: string; note?: string; now?: number };

// A cooperative officer looked at the held evidence and accepts it: the money checks run again,
// then the payout goes out exactly as an automatic release would.
export async function approveHeldClaim(db: Db, { milestoneId, reviewer, note, now = Date.now() }: ReviewInput): Promise<ClaimResult> {
  const { milestone, contract, plot, key } = await loadForReview(db, milestoneId);

  const released = await db
    .select({ type: milestones.type })
    .from(milestones)
    .where(and(eq(milestones.contractId, contract.id), eq(milestones.plotId, plot.id), eq(milestones.state, 'RELEASED')));
  const [completedOp] = await db
    .select({ id: paypalOps.id })
    .from(paypalOps)
    .where(and(eq(paypalOps.key, key), eq(paypalOps.status, 'COMPLETED')));

  const decision = evaluateApproval({
    paypalEnv: env().PAYPAL_ENV,
    contract: { id: contract.id, state: contract.state, escrowRemainingCents: contract.escrowRemainingCents },
    plot: { id: plot.id, eudrStatus: plot.eudrStatus, completedMilestones: PLOT_MILESTONES.filter((m) => released.some((r) => r.type === m)) },
    milestone: { type: milestone.type, version: milestone.version, trancheCents: milestone.trancheCents, shares: milestone.shares },
    held: milestone.state === 'REVIEW',
    findCompletedReceipt: (k) => (k === key ? completedOp?.id : undefined),
  });
  if (decision.kind !== 'RELEASE') return { decision };

  const heldFor = (milestone.decision as { reasons?: string[] } | null)?.reasons ?? [];
  await appendLedger(db, { kind: 'REVIEW_APPROVED', key, milestoneId, reviewer, note: note ?? null, heldFor }, now);
  return release(db, milestone, contract, plot, decision, now);
}

export async function refuseHeldClaim(db: Db, { milestoneId, reviewer, note, now = Date.now() }: ReviewInput): Promise<ClaimResult> {
  const { milestone, key } = await loadForReview(db, milestoneId);
  if (milestone.state !== 'REVIEW') throw conflict(`Milestone ${milestoneId} is not waiting for a review`);

  const decision: GateDecision = { kind: 'REJECT', key, reasons: ['REVIEWER_REFUSED'] };
  await appendLedger(db, { kind: 'REVIEW_REFUSED', key, milestoneId, reviewer, note: note ?? null }, now);
  await db.update(milestones).set({ state: 'PENDING', decision, decidedAt: now }).where(eq(milestones.id, milestone.id));
  publish({ type: 'milestone', milestoneId: milestone.id, state: 'PENDING' });
  return { decision };
}
