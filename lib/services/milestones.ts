import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { serialized } from '../db/lock';
import { billFingerprints, challenges, contracts, evidence, inputDealers, milestones, paypalOps, plots } from '../db/schema';
import { billDateFits, billFingerprint, isSamePhoto, issuerMatches } from '../engine/fraud';
import { evaluateApproval, evaluateRelease, releaseKey, type Bill, type FraudFindings, type GateDecision } from '../engine/gate';
import type { LngLat } from '../engine/geo';
import type { ProofSignal } from '../engine/proof';
import { PLOT_MILESTONES, transition, type PlotMilestone } from '../engine/stateMachine';
import { env } from '../env';
import { publish } from '../events';
import type { RoutedError } from '../paypal-errors';
import { isAuthentic } from './challenges';
import { conflict, notFound } from './errors';
import { appendLedger } from './ledger';
import { PayPalOpFailed } from './ops';
import { sendPayoutBatch } from './payouts';
import { askSellers, sellerDeniedOnPlot } from './confirmations';
import { accrueForVerifiedPlot } from './premium';

export type ClaimInput = {
  milestoneId: string;
  claimedMilestone: PlotMilestone;
  challengeId: string;
  challengeCode: string;
  gps: LngLat;
  vision: { codeMatch: boolean; confidence: number } | null;
  evidence: { kind: 'PHOTO' | 'VOICE' | 'WEIGHT_SLIP'; sha256: string; photoHash?: string | null; oracle?: Record<string, unknown> }[];
  // The bills read from the photo (US cents) with the suppliers the farmer named; only bill stages use them.
  bills?: Bill[] | null;
  signals?: ProofSignal[];
  now?: number;
  // Returns the decision without recording anything or calling PayPal (the tour's cheat runner).
  dryRun?: boolean;
};

export type ClaimResult = { decision: GateDecision; payoutBatchId?: string; error?: RoutedError };

type Milestone = typeof milestones.$inferSelect;
type Plot = typeof plots.$inferSelect;
type Release = Extract<GateDecision, { kind: 'RELEASE' }>;

class EscrowShort extends Error {}

// Sets the tranche aside before any money moves. Both updates are conditional and run in one
// transaction, so two releases racing on the same contract cannot spend the same escrow, and a
// retry of this milestone does not reserve twice.
async function reserveEscrow(db: Db, milestone: Milestone, cents: number): Promise<boolean> {
  try {
    await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(milestones)
        .set({ reservedCents: cents })
        .where(and(eq(milestones.id, milestone.id), eq(milestones.reservedCents, 0)))
        .returning({ id: milestones.id });
      if (!claimed) return;
      const [debited] = await tx
        .update(contracts)
        .set({ escrowRemainingCents: sql`${contracts.escrowRemainingCents} - ${cents}` })
        .where(and(eq(contracts.id, milestone.contractId), gte(contracts.escrowRemainingCents, cents)))
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
    const [held] = await tx.select({ cents: milestones.reservedCents }).from(milestones).where(eq(milestones.id, milestone.id));
    if (!held || held.cents <= 0) return;
    await tx.update(milestones).set({ reservedCents: 0 }).where(eq(milestones.id, milestone.id));
    await tx
      .update(contracts)
      .set({ escrowRemainingCents: sql`${contracts.escrowRemainingCents} + ${held.cents}` })
      .where(eq(contracts.id, milestone.contractId));
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
    if ('payouts' in decision && milestone.rule) await askSellers(tx, milestone.id, decision.payouts, now);
    const [row] = await tx.select().from(contracts).where(eq(contracts.id, milestone.contractId));
    return row;
  });

  publish({ type: 'milestone', milestoneId: milestone.id, state: 'RELEASED' });
  publish({ type: 'contract', contractId: settled.id, state: settled.state, escrowRemainingCents: settled.escrowRemainingCents });
}

async function release(db: Db, milestone: Milestone, plot: Plot, decision: Release, now: number): Promise<ClaimResult> {
  const { key, payouts } = decision;
  const total = payouts.reduce((sum, p) => sum + p.cents, 0);
  if (!(await reserveEscrow(db, milestone, total))) return { decision: { kind: 'REJECT', key, reasons: ['ESCROW_EXCEEDED'] } };
  await appendLedger(db, { kind: 'RELEASE_INTENT', key, milestoneId: milestone.id, payouts }, now);

  let batchId: string;
  try {
    batchId = await sendPayoutBatch(db, { key, payouts, note: `${milestone.type} verified for ${plot.name}`, now });
  } catch (error) {
    if (!(error instanceof PayPalOpFailed)) throw error;
    // A timeout or PayPal server error may still have paid: the money stays reserved, and the retry
    // reuses the same PayPal-Request-Id, so PayPal returns that payout instead of sending another.
    if (error.routed.route !== 'RETRY_WITH_BACKOFF') await returnEscrow(db, milestone);
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
  await reserveEscrow(db, milestone, op.cents ?? milestone.trancheCents);
  await settle(db, milestone, plot, decision, op.paypalId!, now);
  return { decision, payoutBatchId: op.paypalId! };
}

// Each bill must be a kind this stage pays, and a supplier the farmer names must actually be
// that kind (a labour group can't be paid for a fertiliser bill).
async function checkedBills(db: Db, milestone: Milestone, bills: Bill[] | null | undefined): Promise<Bill[] | null> {
  if (!milestone.rule || !bills?.length) return null;
  const kinds = new Set(milestone.rule.lines.map((l) => l.kind));
  const named = bills.flatMap((b) => (b.payeeId ? [b.payeeId] : []));
  const suppliers = named.length ? await db.select({ id: inputDealers.id, kind: inputDealers.kind }).from(inputDealers).where(inArray(inputDealers.id, named)) : [];
  for (const bill of bills) {
    if (!kinds.has(bill.kind)) throw conflict(`This stage doesn't pay ${bill.kind.toLowerCase()} bills`);
    if (bill.payeeId && suppliers.find((s) => s.id === bill.payeeId)?.kind !== bill.kind) throw conflict('That supplier cannot be paid for this bill');
  }
  return bills;
}

// Looks back over this season's evidence for the same photo or the same bill sent before, and
// checks each bill's printed name and date against the supplier paid and the stage.
async function fraudFindings(db: Db, milestone: Milestone, input: ClaimInput, bills: Bill[] | null, now: number): Promise<FraudFindings> {
  const hash = input.evidence.find((e) => e.kind === 'PHOTO')?.photoHash;
  const earlier = hash
    ? await db
        .select({ hash: evidence.photoHash })
        .from(evidence)
        .innerJoin(milestones, eq(evidence.milestoneId, milestones.id))
        .where(and(eq(milestones.contractId, milestone.contractId), ne(evidence.milestoneId, milestone.id), isNotNull(evidence.photoHash)))
    : [];

  const prints = (bills ?? []).flatMap((b) => billFingerprint(b) ?? []);
  const taken = prints.length
    ? await db.select().from(billFingerprints).where(and(eq(billFingerprints.contractId, milestone.contractId), inArray(billFingerprints.fingerprint, prints)))
    : [];

  const payeeOf = (b: Bill) => b.payeeId ?? milestone.rule?.lines.find((l) => l.kind === b.kind)?.payeeId;
  const payeeIds = [...new Set((bills ?? []).flatMap((b) => payeeOf(b) ?? []))];
  const names = payeeIds.length ? await db.select({ id: inputDealers.id, name: inputDealers.name }).from(inputDealers).where(inArray(inputDealers.id, payeeIds)) : [];

  return {
    photoUsedBefore: earlier.some((e) => isSamePhoto(e.hash!, hash!)),
    billPaidBefore: taken.some((t) => t.milestoneId !== milestone.id),
    issuerMismatch: (bills ?? []).some((b) => {
      const name = names.find((n) => n.id === payeeOf(b))?.name;
      return name !== undefined && issuerMatches(b.issuer, name) === false;
    }),
    billDateOutside: (bills ?? []).some((b) => billDateFits(b.date, milestone.opensAt, now) === false),
    sellerDenied: await sellerDeniedOnPlot(db, milestone.plotId),
  };
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

  const bills = await checkedBills(db, milestone, input.bills);
  const fraud = await fraudFindings(db, milestone, input, bills, now);
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
      rule: milestone.rule,
    },
    claim: { milestone: input.claimedMilestone, gps: input.gps, challengeCode: input.challengeCode, bills },
    challenge: challenge && isAuthentic(challenge) ? challenge : null,
    vision: input.vision,
    fraud,
    signals: input.signals,
    findCompletedReceipt: (k) => (k === key ? completedOp?.id : undefined),
  });

  if (input.dryRun) return { decision };
  if (decision.kind === 'DEDUPED') return finishPaidRelease(db, milestone, plot, decision, now);

  if (challenge && challenge.usedAt === null && challenge.code === input.challengeCode) {
    await db.update(challenges).set({ usedAt: now }).where(eq(challenges.id, challenge.id));
  }
  if (milestone.rule) await db.update(milestones).set({ bills: input.bills ?? null }).where(eq(milestones.id, milestone.id));
  if (!fraud.billPaidBefore && bills?.length) {
    const prints = bills.flatMap((b) => billFingerprint(b) ?? []);
    if (prints.length) {
      await db
        .insert(billFingerprints)
        .values(prints.map((fingerprint) => ({ contractId: milestone.contractId, fingerprint, milestoneId: milestone.id, createdAt: now })))
        .onConflictDoNothing();
    }
  }
  if (input.evidence.length) {
    await db.insert(evidence).values(
      input.evidence.map((e) => ({
        id: randomUUID(),
        milestoneId: milestone.id,
        challengeId: challenge?.id ?? null,
        kind: e.kind,
        sha256: e.sha256,
        photoHash: e.photoHash ?? null,
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

// bills: for a bill stage whose totals couldn't be read, the amounts the officer read off the bills.
export type ReviewInput = { milestoneId: string; reviewer: string; note?: string; bills?: Bill[]; now?: number };

// A cooperative officer looked at the held evidence and accepts it: the money checks run again,
// then the payout goes out exactly as an automatic release would.
export async function approveHeldClaim(db: Db, input: ReviewInput): Promise<ClaimResult> {
  return serialized(`contract:${await contractOf(db, input.milestoneId)}`, () => approveNow(db, input));
}

async function approveNow(db: Db, { milestoneId, reviewer, note, bills, now = Date.now() }: ReviewInput): Promise<ClaimResult> {
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
    milestone: { type: milestone.type, version: milestone.version, trancheCents: milestone.trancheCents, shares: milestone.shares, rule: milestone.rule },
    bills: (await checkedBills(db, milestone, bills)) ?? milestone.bills,
    held: milestone.state === 'REVIEW',
    findCompletedReceipt: (k) => (k === key ? completedOp?.id : undefined),
  });
  if (decision.kind === 'DEDUPED') return finishPaidRelease(db, milestone, plot, decision, now);
  if (decision.kind !== 'RELEASE') return { decision };

  const heldFor = (milestone.decision as { reasons?: string[] } | null)?.reasons ?? [];
  if (bills) await db.update(milestones).set({ bills }).where(eq(milestones.id, milestoneId));
  await appendLedger(db, { kind: 'REVIEW_APPROVED', key, milestoneId, reviewer, note: note ?? null, heldFor, ...(bills && { bills }) }, now);
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
