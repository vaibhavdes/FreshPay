import { withinPlot, type LngLat } from './geo';
import { allocate, type Allocation, type Share } from './splits';
import { nextPlotMilestone, type ContractState, type PlotMilestone } from './stateMachine';

export type EudrStatus = 'PASS' | 'REVIEW' | 'FAIL';

// Who a stage's bill can be paid to: the input seller, a labour group, or machinery hire.
export const SUPPLIER_KINDS = ['INPUTS', 'LABOUR', 'MACHINERY'] as const;
export type SupplierKind = (typeof SUPPLIER_KINDS)[number];

// A bill stage pays the supplier on the bill what it says, never more than the cap, plus the
// farmer's fixed allowance. `dealerId` is the supplier paid when the farmer names none.
// Fixed stages have no rule and split their tranche by shares.
export type BillRule = { kind: 'BILL'; capCents: number; labourCents: number; dealerId: string; farmerId: string; payeeKinds?: SupplierKind[] };

export function stagePayouts(
  milestone: { trancheCents: number; shares: readonly Share[]; rule?: BillRule | null },
  billCents: number | null,
  payeeId: string | null = null,
): Allocation[] | null {
  if (!milestone.rule) return allocate(milestone.trancheCents, milestone.shares);
  if (billCents === null || billCents <= 0) return null;
  const { capCents, labourCents, dealerId, farmerId } = milestone.rule;
  return [
    { id: payeeId ?? dealerId, cents: Math.min(billCents, capCents) },
    { id: farmerId, cents: labourCents },
  ];
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
  // billCents: the bill total the model read, converted to US cents by code; null when unreadable.
  // payeeId: the supplier on the bill, already checked against the stage's allowed kinds.
  claim: { milestone: PlotMilestone; gps: LngLat; challengeCode: string; billCents?: number | null; payeeId?: string | null };
  challenge: { code: string; issuedAt: number; usedAt: number | null } | null;
  // Null when no model could read the evidence: everything else is still checked, then a person decides.
  vision: { codeMatch: boolean; confidence: number } | null;
  premium?: { cents: number; mandate: { capCents: number; usedCents: number } | null };
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
  | 'BILL_AMOUNT_MISSING';

export type ReviewReason = 'EUDR_REVIEW' | 'LOW_CONFIDENCE' | 'ORACLE_UNAVAILABLE' | 'BILL_UNREADABLE';

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

  const { now, contract, plot, milestone, claim, challenge, vision, premium } = input;
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

  const payouts = stagePayouts(milestone, claim.billCents ?? null, claim.payeeId ?? null);
  if (!payouts) reviews.push('BILL_UNREADABLE');
  if ((payouts ? totalOf(payouts) : milestone.trancheCents) > contract.escrowRemainingCents) rejects.push('ESCROW_EXCEEDED');

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
  // For a bill stage: the amount read from the bill, or entered by the officer if it couldn't be read.
  billCents?: number | null;
  payeeId?: string | null;
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
  const payouts = stagePayouts(milestone, input.billCents ?? null, input.payeeId ?? null);
  if (!payouts) rejects.push('BILL_AMOUNT_MISSING');
  if ((payouts ? totalOf(payouts) : milestone.trancheCents) > contract.escrowRemainingCents) rejects.push('ESCROW_EXCEEDED');

  if (rejects.length || !payouts) return { kind: 'REJECT', key, reasons: rejects };
  return { kind: 'RELEASE', key, payouts, premiumCents: 0 };
}
