import { randomUUID } from 'node:crypto';
import { and, eq, gt, gte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { serialized } from '../db/lock';
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
type Plot = typeof plots.$inferSelect;
type Release = Extract<GateDecision, { kind: 'RELEASE' }>;

class EscrowShort extends Error {}

// Sets the tranche aside before any money moves. Both updates are conditional and run in one
// transaction, so two releases racing on the same contract cannot spend the same escrow, and a
// retry of this milestone does not reserve twice.
async function reserveEscrow(db: Db, milestone: Milestone): Promise<boolean> {
  try {
    await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(milestones)
        .set({ reservedCents: milestone.trancheCents })
        .where(and(eq(milestones.id, milestone.id), eq(milestones.reservedCents, 0)))
        .returning({ id: milestones.id });
      if (!claimed) return;
      const [debited] = await tx
        .update(contracts)
        .set({ escrowRemainingCents: sql`${contracts.escrowRemainingCents} - ${milestone.trancheCents}` })
        .where(and(eq(contracts.id, milestone.contractId), gte(contracts.escrowRemainingCents, milestone.trancheCents)))
        .returning({ id: contracts.id });
      if (!debited) throw new EscrowShort();
    });
    return true;
  } catch (error) {
    if (error instanceof EscrowShort) return false;
    throw error;
  }
}

// PayPal refused the payout, so the reserved tranche goes back to the contract.
async function returnEscrow(db: Db, milestone: Milestone) {
  await db.transaction(async (tx) => {
    const [returned] = await tx
      .update(milestones)
      .set({ reservedCents: 0 })
      .where(and(eq(milestones.id, milestone.id), gt(milestones.reservedCents, 0)))
      .returning({ cents: milestones.trancheCents });
    if (returned) {
      await tx
        .update(contracts)
        .set({ escrowRemainingCents: sql`${contracts.escrowRemainingCents} + ${returned.cents}` })
        .where(eq(contracts.id, milestone.contractId));
    }
  });
}

// Records a payout PayPal accepted. Escrow was already debited by the reservation.
async function settle(db: Db, milestone: Milestone, plot: Plot, decision: Release | Extract<GateDecision, { kind: 'DEDUPED' }>, batchId: string, now: number) {
  const settled = await db.transaction(async (tx) => {
    await tx.update(milestones).set({ state: 'RELEASED', decision, decidedAt: now }).where(eq(milestones.id, milestone.id));
    await tx
      .update(contracts)
      .set({ state: transition('FUNDED', 'ACTIVATE') })
      .where(and(eq(contracts.id, milestone.contractId), eq(contracts.state, 'FUNDED')));
    await appendLedger(tx, { kind: 'RELEASE_RESULT', key: decision.key, payoutBatchId: batchId }, now);
    if (milestone.type === 'PLOT_VERIFIED') await accrueForVerifiedPlot(tx, { contractId: milestone.contractId, plotId: plot.id, farmerId: plot.farmerId }, now);
    const [row] = await tx.select().from(contracts).where(eq(contracts.id, milestone.contractId));
    return row;
  });

  publish({ type: 'milestone', milestoneId: milestone.id, state: 'RELEASED' });
  publish({ type: 'contract', contractId: settled.id, state: settled.state, escrowRemainingCents: settled.escrowRemainingCents });
}

async function release(db: Db, milestone: Milestone, plot: Plot, decision: Release, now: number): Promise<ClaimResult> {
  const { key, payouts } = decision;
  if (!(await reserveEscrow(db, milestone))) return { decision: { kind: 'REJECT', key, reasons: ['ESCROW_EXCEEDED'] } };
  await appendLedger(db, { kind: 'RELEASE_INTENT', key, milestoneId: milestone.id, payouts }, now);

  let batchId: string;
  try {
    batchId = await sendPayoutBatch(db, { key, payouts, note: `${milestone.type} verified for ${plot.name}`, now });
  } catch (error) {
    if (!(error instanceof PayPalOpFailed)) throw error;
    await returnEscrow(db, milestone);
    await appendLedger(db, { kind: 'RELEASE_FAILED', key, opId: error.op.id, route: error.routed.route, issue: error.routed.issue }, now);
    return { decision, error: error.routed };
  }

  await settle(db, milestone, plot, decision, batchId, now);
  return { decision, payoutBatchId: batchId };
}

// The payout already went through but the milestone was never marked paid (the process stopped
// in between). Finish the bookkeeping instead of treating the claim as a duplicate.
async function finishPaidRelease(db: Db, milestone: Milestone, plot: Plot, decision: Extract<GateDecision, { kind: 'DEDUPED' }>, now: number): Promise<ClaimResult> {
  if (milestone.state === 'RELEASED') return { decision };
  const [op] = await db.select().from(paypalOps).where(eq(paypalOps.id, decision.receiptId));
  await reserveEscrow(db, milestone);
  await settle(db, milestone, plot, decision, op.paypalId!, now);
  return { decision, payoutBatchId: op.paypalId! };
}

async function contractOf(db: Db, milestoneId: string): Promise<string> {
  const [row] = await db.select({ contractId: milestones.contractId }).from(milestones).where(eq(milestones.id, milestoneId));
  if (!row) throw notFound(`Milestone ${milestoneId}`);
  return row.contractId;
}

export async function submitClaim(db: Db, input: ClaimInput): Promise<ClaimResult> {
  return serialized(`contract:${await contractOf(db, input.milestoneId)}`, () => decideClaim(db, input));
}

async function decideClaim(db: Db, input: ClaimInput): Promise<ClaimResult> {
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

  if (decision.kind === 'DEDUPED') return finishPaidRelease(db, milestone, plot, decision, now);

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

  if (decision.kind === 'RELEASE') return release(db, milestone, plot, decision, now);

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
export async function approveHeldClaim(db: Db, input: ReviewInput): Promise<ClaimResult> {
  return serialized(`contract:${await contractOf(db, input.milestoneId)}`, () => approveNow(db, input));
}

async function approveNow(db: Db, { milestoneId, reviewer, note, now = Date.now() }: ReviewInput): Promise<ClaimResult> {
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
  if (decision.kind === 'DEDUPED') return finishPaidRelease(db, milestone, plot, decision, now);
  if (decision.kind !== 'RELEASE') return { decision };

  const heldFor = (milestone.decision as { reasons?: string[] } | null)?.reasons ?? [];
  await appendLedger(db, { kind: 'REVIEW_APPROVED', key, milestoneId, reviewer, note: note ?? null, heldFor }, now);
  return release(db, milestone, plot, decision, now);
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
