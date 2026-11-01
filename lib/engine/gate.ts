import { withinPlot, type LngLat } from './geo';
import type { ProofSignal } from './proof';
import { allocate, type Allocation, type Share } from './splits';
import { nextPlotMilestone, type ContractState, type PlotMilestone } from './stateMachine';

export type EudrStatus = 'PASS' | 'REVIEW' | 'FAIL';

// Who a stage's bill can be paid to: the input seller, a labour group, or machinery hire.
export const SUPPLIER_KINDS = ['INPUTS', 'LABOUR', 'MACHINERY'] as const;
export type SupplierKind = (typeof SUPPLIER_KINDS)[number];

// A bill stage pays everyone who did the stage's work from their own bills: each kind of bill
// (inputs, labour, machinery) up to its own cap, plus the farmer's fixed share. `payeeId` on a
// line is the supplier paid when the farmer names none. Fixed stages have no rule and split
// their tranche by shares.
export type BillLine = { kind: SupplierKind; capCents: number; payeeId: string };
export type BillRule = { kind: 'BILL'; lines: BillLine[]; labourCents: number; farmerId: string };

// A bill as code converted it: what it is for, its total in US cents, who is paid for it, and
// what was printed on it (issuer, bill number, date) for the fraud checks.
export type Bill = { kind: SupplierKind; cents: number; payeeId?: string | null; issuer?: string | null; number?: string | null; date?: string | null };

// What the fraud checks found, worked out from the season's earlier evidence before the gate runs.
export type FraudFindings = { photoUsedBefore: boolean; billPaidBefore: boolean; issuerMismatch: boolean; billDateOutside: boolean; sellerDenied?: boolean };

export function stagePayouts(milestone: { trancheCents: number; shares: readonly Share[]; rule?: BillRule | null }, bills: readonly Bill[] | null): Allocation[] | null {
  if (!milestone.rule) return allocate(milestone.trancheCents, milestone.shares);
  const { lines, labourCents, farmerId } = milestone.rule;
  const usable = (bills ?? []).filter((b) => b.cents > 0 && lines.some((l) => l.kind === b.kind));
  if (!usable.length) return null;

  const owed = new Map<string, number>();
  for (const line of lines) {
    const ofKind = usable.filter((b) => b.kind === line.kind);
    const cents = Math.min(ofKind.reduce((sum, b) => sum + b.cents, 0), line.capCents);
    if (!cents) continue;
    const payeeId = ofKind.find((b) => b.payeeId)?.payeeId ?? line.payeeId;
    owed.set(payeeId, (owed.get(payeeId) ?? 0) + cents);
  }
  owed.set(farmerId, (owed.get(farmerId) ?? 0) + labourCents);
  return [...owed].map(([id, cents]) => ({ id, cents }));
}

const totalOf = (payouts: Allocation[]) => payouts.reduce((sum, p) => sum + p.cents, 0);

export type GateInput = {
  paypalEnv: 'sandbox' | 'live';
  now: number;
  contract: { id: string; state: ContractState; escrowRemainingCents: number };
  plot: { id: string; ring: readonly LngLat[]; eudrStatus: EudrStatus; completedMilestones: readonly PlotMilestone[] };
  milestone: {
    type: PlotMilestone;
    version: number;
    opensAt: number;
    closesAt: number;
    trancheCents: number;
    shares: readonly Share[];
    rule?: BillRule | null;
  };
  // bills: what the model read from the bills, converted and checked against suppliers by code.
  claim: { milestone: PlotMilestone; gps: LngLat; challengeCode: string; bills?: Bill[] | null };
  challenge: { code: string; issuedAt: number; usedAt: number | null } | null;
  // Null when no model could read the evidence: everything else is still checked, then a person decides.
  vision: { codeMatch: boolean; confidence: number } | null;
  premium?: { cents: number; mandate: { capCents: number; usedCents: number } | null };
  fraud?: FraudFindings;
  // Camera, phone, weather and satellite signals; any warning holds the claim for a person.
  signals?: readonly ProofSignal[];
  findCompletedReceipt: (key: string) => string | undefined;
};

export type GatePolicy = { challengeTtlMs: number; gpsBufferMeters: number; minVisionConfidence: number };

export const DEFAULT_POLICY: GatePolicy = { challengeTtlMs: 15 * 60_000, gpsBufferMeters: 100, minVisionConfidence: 0.8 };

export type RejectReason =
  | 'CONTRACT_NOT_ACTIVE'
  | 'MILESTONE_OUT_OF_ORDER'
  | 'CHALLENGE_MISSING'
  | 'CHALLENGE_MISMATCH'
  | 'CHALLENGE_EXPIRED'
  | 'CHALLENGE_USED'
  | 'VISION_CODE_MISMATCH'
  | 'OUTSIDE_PLOT'
  | 'OUTSIDE_WINDOW'
  | 'EUDR_FAILED'
  | 'ESCROW_EXCEEDED'
  | 'PREMIUM_NOT_ALLOWED'
  | 'NO_MANDATE'
  | 'MANDATE_EXCEEDED'
  | 'NOT_HELD_FOR_REVIEW'
  | 'REVIEWER_REFUSED'
  | 'BILL_AMOUNT_MISSING'
  | 'BILL_ALREADY_PAID';

export type ReviewReason =
  | 'EUDR_REVIEW'
  | 'LOW_CONFIDENCE'
  | 'ORACLE_UNAVAILABLE'
  | 'BILL_UNREADABLE'
  | 'PHOTO_USED_BEFORE'
  | 'BILL_ISSUER_MISMATCH'
  | 'BILL_DATE_OUTSIDE'
  | 'SELLER_DENIED_BILL'
  | 'PROOF_SIGNAL_WARNING';

export type GateDecision =
  | { kind: 'RELEASE'; key: string; payouts: Allocation[]; premiumCents: number }
  | { kind: 'DEDUPED'; key: string; receiptId: string }
  | { kind: 'REVIEW'; key: string; reasons: ReviewReason[] }
  | { kind: 'REJECT'; key: string; reasons: (RejectReason | ReviewReason)[] };

export class LiveEnvironmentRefused extends Error {
  constructor() {
    super('The release gate refuses to run against PAYPAL_ENV=live');
    this.name = 'LiveEnvironmentRefused';
  }
}

export function releaseKey(contractId: string, plotId: string, milestone: PlotMilestone, version: number): string {
  return `${contractId}/${plotId}/${milestone}/release/v${version}`;
}

export function evaluateRelease(input: GateInput, policy: GatePolicy = DEFAULT_POLICY): GateDecision {
  if (input.paypalEnv !== 'sandbox') throw new LiveEnvironmentRefused();

  const { now, contract, plot, milestone, claim, challenge, vision, premium, fraud, signals } = input;
  const key = releaseKey(contract.id, plot.id, milestone.type, milestone.version);

  const receiptId = input.findCompletedReceipt(key);
  if (receiptId) return { kind: 'DEDUPED', key, receiptId };

  const rejects: RejectReason[] = [];
  const reviews: ReviewReason[] = [];

  if (contract.state !== 'FUNDED' && contract.state !== 'ACTIVE') rejects.push('CONTRACT_NOT_ACTIVE');
  if (claim.milestone !== milestone.type || nextPlotMilestone(plot.completedMilestones) !== milestone.type) {
    rejects.push('MILESTONE_OUT_OF_ORDER');
  }

  if (!challenge) rejects.push('CHALLENGE_MISSING');
  else {
    if (challenge.code !== claim.challengeCode) rejects.push('CHALLENGE_MISMATCH');
    if (challenge.usedAt !== null) rejects.push('CHALLENGE_USED');
    if (now < challenge.issuedAt || now - challenge.issuedAt > policy.challengeTtlMs) rejects.push('CHALLENGE_EXPIRED');
  }
  if (!vision) reviews.push('ORACLE_UNAVAILABLE');
  else {
    if (!vision.codeMatch) rejects.push('VISION_CODE_MISMATCH');
    if (vision.confidence < policy.minVisionConfidence) reviews.push('LOW_CONFIDENCE');
  }

  if (!withinPlot(claim.gps, plot.ring, policy.gpsBufferMeters)) rejects.push('OUTSIDE_PLOT');
  if (now < milestone.opensAt || now > milestone.closesAt) rejects.push('OUTSIDE_WINDOW');

  if (plot.eudrStatus === 'FAIL') rejects.push('EUDR_FAILED');
  if (plot.eudrStatus === 'REVIEW') reviews.push('EUDR_REVIEW');

  const payouts = stagePayouts(milestone, claim.bills ?? null);
  if (!payouts) reviews.push('BILL_UNREADABLE');
  if ((payouts ? totalOf(payouts) : milestone.trancheCents) > contract.escrowRemainingCents) rejects.push('ESCROW_EXCEEDED');

  if (fraud?.billPaidBefore) rejects.push('BILL_ALREADY_PAID');
  if (fraud?.photoUsedBefore) reviews.push('PHOTO_USED_BEFORE');
  if (fraud?.issuerMismatch) reviews.push('BILL_ISSUER_MISMATCH');
  if (fraud?.billDateOutside) reviews.push('BILL_DATE_OUTSIDE');
  if (fraud?.sellerDenied) reviews.push('SELLER_DENIED_BILL');
  if (signals?.some((s) => s.status === 'WARN')) reviews.push('PROOF_SIGNAL_WARNING');

  if (premium && premium.cents > 0) {
    if (milestone.type !== 'PLOT_VERIFIED') rejects.push('PREMIUM_NOT_ALLOWED');
    if (!premium.mandate) rejects.push('NO_MANDATE');
    else if (premium.cents > premium.mandate.capCents - premium.mandate.usedCents) rejects.push('MANDATE_EXCEEDED');
  }

  if (rejects.length) return { kind: 'REJECT', key, reasons: [...rejects, ...reviews] };
  if (reviews.length) return { kind: 'REVIEW', key, reasons: reviews };

  return { kind: 'RELEASE', key, payouts: payouts!, premiumCents: premium?.cents ?? 0 };
}

export type ApprovalInput = Pick<GateInput, 'paypalEnv' | 'contract' | 'findCompletedReceipt'> & {
  plot: Pick<GateInput['plot'], 'id' | 'eudrStatus' | 'completedMilestones'>;
  milestone: Pick<GateInput['milestone'], 'type' | 'version' | 'trancheCents' | 'shares' | 'rule'>;
  // For a bill stage: the bills read from the photo, or entered by the officer if they couldn't be read.
  bills?: Bill[] | null;
  held: boolean;
};

// A person approving a held claim stands in for the review reasons only. The evidence checks passed
// when the claim was made (otherwise it would not be held); the money checks run again now.
export function evaluateApproval(input: ApprovalInput): GateDecision {
  if (input.paypalEnv !== 'sandbox') throw new LiveEnvironmentRefused();

  const { contract, plot, milestone } = input;
  const key = releaseKey(contract.id, plot.id, milestone.type, milestone.version);

  const receiptId = input.findCompletedReceipt(key);
  if (receiptId) return { kind: 'DEDUPED', key, receiptId };

  const rejects: RejectReason[] = [];
  if (!input.held) rejects.push('NOT_HELD_FOR_REVIEW');
  if (contract.state !== 'FUNDED' && contract.state !== 'ACTIVE') rejects.push('CONTRACT_NOT_ACTIVE');
  if (nextPlotMilestone(plot.completedMilestones) !== milestone.type) rejects.push('MILESTONE_OUT_OF_ORDER');
  if (plot.eudrStatus === 'FAIL') rejects.push('EUDR_FAILED');
  const payouts = stagePayouts(milestone, input.bills ?? null);
  if (!payouts) rejects.push('BILL_AMOUNT_MISSING');
  if ((payouts ? totalOf(payouts) : milestone.trancheCents) > contract.escrowRemainingCents) rejects.push('ESCROW_EXCEEDED');

  if (rejects.length || !payouts) return { kind: 'REJECT', key, reasons: rejects };
  return { kind: 'RELEASE', key, payouts, premiumCents: 0 };
}
