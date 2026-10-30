import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { challenges, contracts, evidence, farmers, inputDealers, milestones, payoutItems, paypalOps, plots } from '../db/schema';
import { evaluateRelease, releaseKey, type GateDecision } from '../engine/gate';
import type { LngLat } from '../engine/geo';
import { PLOT_MILESTONES, transition, type PlotMilestone } from '../engine/stateMachine';
import { env } from '../env';
import { publish } from '../events';
import { paypalRequest } from '../paypal';
import type { RoutedError } from '../paypal-errors';
import { centsToValue } from '../paypal-sdk';
import { isAuthentic } from './challenges';
import { notFound } from './errors';
import { appendLedger } from './ledger';
import { PayPalOpFailed, runOp } from './ops';

export type ClaimInput = {
  milestoneId: string;
  claimedMilestone: PlotMilestone;
  challengeId: string;
  challengeCode: string;
  gps: LngLat;
  vision: { codeMatch: boolean; confidence: number };
  evidence: { kind: 'PHOTO' | 'VOICE' | 'WEIGHT_SLIP'; sha256: string; oracle?: Record<string, unknown> }[];
  now?: number;
};

export type ClaimResult = { decision: GateDecision; payoutBatchId?: string; error?: RoutedError };

type Milestone = typeof milestones.$inferSelect;
type Contract = typeof contracts.$inferSelect;
type Plot = typeof plots.$inferSelect;
type Release = Extract<GateDecision, { kind: 'RELEASE' }>;

const payoutItemId = (key: string, payeeId: string) => `item-${createHash('sha256').update(`${key}|${payeeId}`).digest('hex').slice(0, 24)}`;

async function receiversOf(db: Db, ids: string[]): Promise<Map<string, string>> {
  const rows = [
    ...(await db.select({ id: farmers.id, email: farmers.paypalEmail }).from(farmers).where(inArray(farmers.id, ids))),
    ...(await db.select({ id: inputDealers.id, email: inputDealers.paypalEmail }).from(inputDealers).where(inArray(inputDealers.id, ids))),
  ];
  return new Map(rows.map((r) => [r.id, r.email]));
}

async function release(db: Db, milestone: Milestone, contract: Contract, plot: Plot, decision: Release, now: number): Promise<ClaimResult> {
  const { key, payouts } = decision;
  await appendLedger(db, { kind: 'RELEASE_INTENT', key, milestoneId: milestone.id, payouts }, now);

  const receivers = await receiversOf(db, payouts.map((p) => p.id));
  const items = payouts
    .filter((p) => p.cents > 0)
    .map((p) => {
      const receiver = receivers.get(p.id);
      if (!receiver) throw notFound(`Payee ${p.id}`);
      return { id: payoutItemId(key, p.id), payeeId: p.id, receiver, cents: p.cents };
    });

  let batchId: string;
  try {
    const { op } = await runOp(db, { op: 'payouts.batch', key }, async (requestId, opId) => {
      await db
        .insert(payoutItems)
        .values(items.map((i) => ({ ...i, opId, status: 'PENDING', updatedAt: now })))
        .onConflictDoNothing();
      const { batch_header } = await paypalRequest<{ batch_header: { payout_batch_id: string } }>('/v1/payments/payouts', {
        method: 'POST',
        requestId,
        body: {
          sender_batch_header: { sender_batch_id: requestId, email_subject: 'AgriTranche crop payment', recipient_type: 'EMAIL' },
          items: items.map((i) => ({
            amount: { value: centsToValue(i.cents), currency: 'USD' },
            receiver: i.receiver,
            sender_item_id: i.id,
            note: `${milestone.type} verified for ${plot.name}`,
          })),
        },
      });
      return { paypalId: batch_header.payout_batch_id, completed: true };
    });
    batchId = op.paypalId!;
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

// Without a reading the evidence can't be verified either way, so the money stays put for a human.
export async function holdForReview(db: Db, milestoneId: string, now = Date.now()): Promise<ClaimResult> {
  const [milestone] = await db.select().from(milestones).where(eq(milestones.id, milestoneId));
  if (!milestone) throw notFound(`Milestone ${milestoneId}`);

  const [contract] = await db.select({ id: contracts.id }).from(contracts).where(eq(contracts.id, milestone.contractId));
  const decision: GateDecision = {
    kind: 'REVIEW',
    key: releaseKey(contract.id, milestone.plotId, milestone.type, milestone.version),
    reasons: ['ORACLE_UNAVAILABLE'],
  };
  await db.update(milestones).set({ state: 'REVIEW', decision, decidedAt: now }).where(eq(milestones.id, milestone.id));
  publish({ type: 'milestone', milestoneId: milestone.id, state: 'REVIEW' });
  return { decision };
}
