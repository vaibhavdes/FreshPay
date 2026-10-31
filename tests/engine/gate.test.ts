import { describe, expect, it } from 'vitest';
import { evaluateApproval, evaluateRelease, LiveEnvironmentRefused, releaseKey, type ApprovalInput, type Bill, type BillRule, type GateInput } from '@/lib/engine/gate';

const NOW = Date.UTC(2026, 10, 3, 6, 0);
const MINUTE = 60_000;

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    paypalEnv: 'sandbox',
    now: NOW,
    contract: { id: 'contract-1', state: 'ACTIVE', escrowRemainingCents: 100_000 },
    plot: {
      id: 'plot-1',
      ring: [
        [75.77, 13.32],
        [75.772, 13.32],
        [75.772, 13.322],
        [75.77, 13.322],
      ],
      eudrStatus: 'PASS',
      completedMilestones: ['PLOT_VERIFIED'],
    },
    milestone: {
      type: 'INPUTS',
      version: 1,
      opensAt: NOW - 24 * 60 * MINUTE,
      closesAt: NOW + 24 * 60 * MINUTE,
      trancheCents: 4501,
      shares: [
        { id: 'dealer-1', weight: 60 },
        { id: 'farmer-1', weight: 40 },
      ],
    },
    claim: { milestone: 'INPUTS', gps: [75.771, 13.321], challengeCode: 'K7Q2' },
    challenge: { code: 'K7Q2', issuedAt: NOW - 5 * MINUTE, usedAt: null },
    vision: { codeMatch: true, confidence: 0.93 },
    findCompletedReceipt: () => undefined,
    ...overrides,
  };
}

const reasonsOf = (overrides: Partial<GateInput>) => {
  const decision = evaluateRelease(input(overrides));
  return decision.kind === 'REJECT' || decision.kind === 'REVIEW' ? decision.reasons : [];
};

describe('evaluateRelease', () => {
  it('releases a verified milestone as an exact split', () => {
    expect(evaluateRelease(input())).toEqual({
      kind: 'RELEASE',
      key: 'contract-1/plot-1/INPUTS/release/v1',
      payouts: [
        { id: 'dealer-1', cents: 2701 },
        { id: 'farmer-1', cents: 1800 },
      ],
      premiumCents: 0,
    });
  });

  it('refuses to run against live PayPal', () => {
    expect(() => evaluateRelease(input({ paypalEnv: 'live' }))).toThrow(LiveEnvironmentRefused);
  });

  it('returns the existing receipt for a release that already completed', () => {
    const key = releaseKey('contract-1', 'plot-1', 'INPUTS', 1);
    const decision = evaluateRelease(input({ findCompletedReceipt: (k) => (k === key ? 'receipt-9' : undefined) }));
    expect(decision).toEqual({ kind: 'DEDUPED', key, receiptId: 'receipt-9' });
  });

  it.each<[string, Partial<GateInput>, string]>([
    ['the contract is not running', { contract: { id: 'contract-1', state: 'DELIVERING', escrowRemainingCents: 100_000 } }, 'CONTRACT_NOT_ACTIVE'],
    ['the farmer claims a different milestone', { claim: { milestone: 'HARVEST', gps: [75.771, 13.321], challengeCode: 'K7Q2' } }, 'MILESTONE_OUT_OF_ORDER'],
    ['no challenge was issued', { challenge: null }, 'CHALLENGE_MISSING'],
    ['the code does not match', { claim: { milestone: 'INPUTS', gps: [75.771, 13.321], challengeCode: 'XXXX' } }, 'CHALLENGE_MISMATCH'],
    ['the challenge was already used', { challenge: { code: 'K7Q2', issuedAt: NOW - MINUTE, usedAt: NOW - MINUTE } }, 'CHALLENGE_USED'],
    ['the challenge is older than 15 minutes', { challenge: { code: 'K7Q2', issuedAt: NOW - 16 * MINUTE, usedAt: null } }, 'CHALLENGE_EXPIRED'],
    ['the challenge is issued in the future', { challenge: { code: 'K7Q2', issuedAt: NOW + MINUTE, usedAt: null } }, 'CHALLENGE_EXPIRED'],
    ['the photo shows another code', { vision: { codeMatch: false, confidence: 0.95 } }, 'VISION_CODE_MISMATCH'],
    ['the phone is far from the plot', { claim: { milestone: 'INPUTS', gps: [75.78, 13.33], challengeCode: 'K7Q2' } }, 'OUTSIDE_PLOT'],
    ['the window has closed', { now: NOW + 25 * 60 * MINUTE, challenge: { code: 'K7Q2', issuedAt: NOW + 25 * 60 * MINUTE - MINUTE, usedAt: null } }, 'OUTSIDE_WINDOW'],
    ['the window has not opened', { now: NOW - 25 * 60 * MINUTE, challenge: { code: 'K7Q2', issuedAt: NOW - 25 * 60 * MINUTE - MINUTE, usedAt: null } }, 'OUTSIDE_WINDOW'],
    ['the escrow cannot cover the tranche', { contract: { id: 'contract-1', state: 'ACTIVE', escrowRemainingCents: 4500 } }, 'ESCROW_EXCEEDED'],
  ])('rejects when %s', (_, overrides, reason) => {
    const decision = evaluateRelease(input(overrides));
    expect(decision.kind).toBe('REJECT');
    expect(reasonsOf(overrides)).toContain(reason);
  });

  it('rejects a plot that fails the EUDR deforestation check', () => {
    const plot = { ...input().plot, eudrStatus: 'FAIL' as const };
    expect(evaluateRelease(input({ plot }))).toMatchObject({ kind: 'REJECT', reasons: ['EUDR_FAILED'] });
  });

  it('sends EUDR review and low vision confidence to a human', () => {
    const plot = { ...input().plot, eudrStatus: 'REVIEW' as const };
    expect(evaluateRelease(input({ plot, vision: { codeMatch: true, confidence: 0.5 } }))).toEqual({
      kind: 'REVIEW',
      key: 'contract-1/plot-1/INPUTS/release/v1',
      reasons: ['LOW_CONFIDENCE', 'EUDR_REVIEW'],
    });
  });

  it('keeps review reasons alongside hard rejections', () => {
    expect(reasonsOf({ challenge: null, vision: { codeMatch: true, confidence: 0.5 } })).toEqual(['CHALLENGE_MISSING', 'LOW_CONFIDENCE']);
  });

  describe('traceability premium', () => {
    const verifiedPlot = { ...input().plot, completedMilestones: [] };
    const plotVerified = {
      plot: verifiedPlot,
      milestone: { ...input().milestone, type: 'PLOT_VERIFIED' as const },
      claim: { ...input().claim, milestone: 'PLOT_VERIFIED' as const },
    };

    it('charges the premium within the mandate cap', () => {
      const decision = evaluateRelease(input({ ...plotVerified, premium: { cents: 500, mandate: { capCents: 4000, usedCents: 3500 } } }));
      expect(decision).toMatchObject({ kind: 'RELEASE', premiumCents: 500 });
    });

    it('rejects a premium above what is left on the mandate', () => {
      expect(reasonsOf({ ...plotVerified, premium: { cents: 501, mandate: { capCents: 4000, usedCents: 3500 } } })).toEqual(['MANDATE_EXCEEDED']);
    });

    it('rejects a premium without a mandate', () => {
      expect(reasonsOf({ ...plotVerified, premium: { cents: 500, mandate: null } })).toEqual(['NO_MANDATE']);
    });

    it('only charges the premium when the plot is verified', () => {
      expect(reasonsOf({ premium: { cents: 500, mandate: { capCents: 4000, usedCents: 0 } } })).toEqual(['PREMIUM_NOT_ALLOWED']);
    });

    it('ignores a zero premium', () => {
      expect(evaluateRelease(input({ premium: { cents: 0, mandate: null } }))).toMatchObject({ kind: 'RELEASE', premiumCents: 0 });
    });
  });
});

describe('evaluateRelease without an AI reading', () => {
  it('still runs every other check and holds a clean claim for a person', () => {
    expect(evaluateRelease(input({ vision: null }))).toMatchObject({ kind: 'REVIEW', reasons: ['ORACLE_UNAVAILABLE'] });
  });

  it('rejects a claim that fails the other checks even without a reading', () => {
    expect(reasonsOf({ vision: null, challenge: null })).toEqual(['CHALLENGE_MISSING', 'ORACLE_UNAVAILABLE']);
  });
});

describe('evaluateApproval', () => {
  const approval = (overrides: Partial<ApprovalInput> = {}): ApprovalInput => {
    const { paypalEnv, contract, plot, milestone, findCompletedReceipt } = input();
    return { paypalEnv, contract, plot, milestone, findCompletedReceipt, held: true, ...overrides };
  };

  it('releases a held claim a person approved', () => {
    expect(evaluateApproval(approval())).toMatchObject({ kind: 'RELEASE', payouts: [{ id: 'dealer-1', cents: 2701 }, { id: 'farmer-1', cents: 1800 }] });
  });

  it('refuses to run against live PayPal', () => {
    expect(() => evaluateApproval(approval({ paypalEnv: 'live' }))).toThrow(LiveEnvironmentRefused);
  });

  it('returns the existing receipt when the payment already went out', () => {
    expect(evaluateApproval(approval({ findCompletedReceipt: () => 'receipt-3' }))).toMatchObject({ kind: 'DEDUPED', receiptId: 'receipt-3' });
  });

  it('still enforces the money checks and never overrides a deforestation failure', () => {
    const plot = { ...input().plot, eudrStatus: 'FAIL' as const, completedMilestones: [] };
    const decision = evaluateApproval(
      approval({ held: false, plot, contract: { id: 'contract-1', state: 'SETTLED', escrowRemainingCents: 10 } }),
    );
    expect(decision).toMatchObject({
      kind: 'REJECT',
      reasons: ['NOT_HELD_FOR_REVIEW', 'CONTRACT_NOT_ACTIVE', 'MILESTONE_OUT_OF_ORDER', 'EUDR_FAILED', 'ESCROW_EXCEEDED'],
    });
  });
});

describe('bill stages', () => {
  const rule: BillRule = {
    kind: 'BILL',
    lines: [
      { kind: 'INPUTS', capCents: 4000, payeeId: 'dealer-1' },
      { kind: 'LABOUR', capCents: 1000, payeeId: 'labour-1' },
    ],
    labourCents: 1500,
    farmerId: 'farmer-1',
  };
  const billStage = (bills: Bill[] | null, extra: Partial<GateInput> = {}) => {
    const base = input();
    return input({ milestone: { ...base.milestone, trancheCents: 6500, rule }, claim: { ...base.claim, bills }, ...extra });
  };

  it('pays each supplier their own bill and the farmer their share', () => {
    expect(evaluateRelease(billStage([{ kind: 'INPUTS', cents: 3429 }, { kind: 'LABOUR', cents: 800 }]))).toMatchObject({
      kind: 'RELEASE',
      payouts: [{ id: 'dealer-1', cents: 3429 }, { id: 'labour-1', cents: 800 }, { id: 'farmer-1', cents: 1500 }],
    });
  });

  it('pays the supplier the farmer named on the bill', () => {
    expect(evaluateRelease(billStage([{ kind: 'INPUTS', cents: 2500, payeeId: 'dealer-2' }]))).toMatchObject({ payouts: [{ id: 'dealer-2', cents: 2500 }, { id: 'farmer-1', cents: 1500 }] });
  });

  it('adds up bills of one kind and caps each kind on its own', () => {
    const bills: Bill[] = [{ kind: 'INPUTS', cents: 3000 }, { kind: 'INPUTS', cents: 3000 }, { kind: 'LABOUR', cents: 9900 }];
    expect(evaluateRelease(billStage(bills))).toMatchObject({ payouts: [{ id: 'dealer-1', cents: 4000 }, { id: 'labour-1', cents: 1000 }, { id: 'farmer-1', cents: 1500 }] });
  });

  it('holds the claim for a person when no bill this stage pays can be read', () => {
    expect(evaluateRelease(billStage(null))).toEqual({ kind: 'REVIEW', key: expect.any(String), reasons: ['BILL_UNREADABLE'] });
    expect(evaluateRelease(billStage([{ kind: 'INPUTS', cents: 0 }]))).toMatchObject({ kind: 'REVIEW', reasons: ['BILL_UNREADABLE'] });
    expect(evaluateRelease(billStage([{ kind: 'MACHINERY', cents: 2000 }]))).toMatchObject({ kind: 'REVIEW', reasons: ['BILL_UNREADABLE'] });
  });

  it('checks the escrow against the actual payout, not the cap', () => {
    const base = input();
    const escrow = { contract: { ...base.contract, escrowRemainingCents: 2600 } };
    expect(evaluateRelease(billStage([{ kind: 'INPUTS', cents: 1000 }], escrow))).toMatchObject({ kind: 'RELEASE' });
    expect(evaluateRelease(billStage([{ kind: 'INPUTS', cents: 1200 }], escrow))).toMatchObject({ kind: 'REJECT', reasons: ['ESCROW_EXCEEDED'] });
  });

  it('needs the bill amounts from the officer to approve unreadable bills', () => {
    const { paypalEnv, contract, plot, milestone, findCompletedReceipt } = input();
    const held = { paypalEnv, contract, plot, milestone: { ...milestone, trancheCents: 6500, rule }, findCompletedReceipt, held: true };
    expect(evaluateApproval({ ...held, bills: null })).toMatchObject({ kind: 'REJECT', reasons: ['BILL_AMOUNT_MISSING'] });
    expect(evaluateApproval({ ...held, bills: [{ kind: 'INPUTS', cents: 2000 }] })).toMatchObject({ kind: 'RELEASE', payouts: [{ id: 'dealer-1', cents: 2000 }, { id: 'farmer-1', cents: 1500 }] });
  });
});
