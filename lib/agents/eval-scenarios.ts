import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client';
import { buyers, challenges, contracts, cooperatives, evidence, farmers, milestones, plots } from '../db/schema';
import type { EudrStatus } from '../engine/gate';
import type { LngLat } from '../engine/geo';
import type { PlotMilestone } from '../engine/stateMachine';

// Held claims a careful cooperative officer would decide in a known way; the review agent is
// scored against them by scripts/eval-review-agent.ts.

type Reading = { codeRead: string | null; cropStage: string; confidence: number; notes: string; stageFits: boolean };

export type Scenario = {
  name: string;
  expected: 'APPROVE' | 'REFUSE' | 'UNSURE';
  milestone: PlotMilestone;
  heldBecause: string[];
  reading: Reading | null;
  eudr?: { status: EudrStatus; lossHa: number };
  photoAlsoUsedOnAnotherPlot?: boolean;
};

export const SCENARIOS: Scenario[] = [
  {
    name: 'Dim but genuine photo',
    expected: 'APPROVE',
    milestone: 'INPUTS',
    heldBecause: ['LOW_CONFIDENCE'],
    reading: { codeRead: 'K7Q2AB', cropStage: 'FRUITING', confidence: 0.72, stageFits: true, notes: 'Code is legible on paper beside fertiliser bags; green cherries on shaded coffee; image is slightly dark.' },
  },
  {
    name: 'Looks like an illustration',
    expected: 'REFUSE',
    milestone: 'INPUTS',
    heldBecause: ['LOW_CONFIDENCE'],
    reading: { codeRead: 'K7Q2AB', cropStage: 'FRUITING', confidence: 0.4, stageFits: true, notes: 'The image appears to be a digital illustration rather than a real photograph.' },
  },
  {
    name: 'Photo reused from another plot',
    expected: 'REFUSE',
    milestone: 'INPUTS',
    heldBecause: ['LOW_CONFIDENCE'],
    reading: { codeRead: 'K7Q2AB', cropStage: 'FRUITING', confidence: 0.74, stageFits: true, notes: 'Code legible; coffee with green cherries.' },
    photoAlsoUsedOnAnotherPlot: true,
  },
  {
    name: 'Harvest claimed, cherries still green',
    expected: 'REFUSE',
    milestone: 'HARVEST',
    heldBecause: ['LOW_CONFIDENCE'],
    reading: { codeRead: 'K7Q2AB', cropStage: 'FRUITING', confidence: 0.5, stageFits: false, notes: 'Only hard green cherries on the branches; nothing picked or ripe.' },
  },
  {
    name: 'No AI reading at all',
    expected: 'UNSURE',
    milestone: 'INPUTS',
    heldBecause: ['ORACLE_UNAVAILABLE'],
    reading: null,
  },
  {
    name: 'Good evidence, borderline forest check',
    expected: 'UNSURE',
    milestone: 'INPUTS',
    heldBecause: ['EUDR_REVIEW'],
    reading: { codeRead: 'K7Q2AB', cropStage: 'FRUITING', confidence: 0.9, stageFits: true, notes: 'Clear photo with legible code and coffee bearing green cherries.' },
    eudr: { status: 'REVIEW', lossHa: 0.08 },
  },
];

const RING: LngLat[] = [
  [75.77, 13.32],
  [75.772, 13.32],
  [75.772, 13.322],
  [75.77, 13.322],
];

// Builds one held claim, with its plot, challenge and evidence, and returns its milestone id.
export async function createScenario(db: Db, scenario: Scenario, now = Date.now()): Promise<string> {
  const tag = randomUUID().slice(0, 8);
  const ids = { buyer: `buyer-${tag}`, coop: `coop-${tag}`, farmer: `farmer-${tag}`, plot: `plot-${tag}`, contract: `contract-${tag}`, milestone: `milestone-${tag}` };
  const photoSha = (scenario.photoAlsoUsedOnAnotherPlot ? 'a' : tag).padEnd(64, '0');

  await db.insert(buyers).values({ id: ids.buyer, name: 'Eval buyer', country: 'DE', paypalEmail: 'buyer@farmproof.test', createdAt: now });
  await db.insert(cooperatives).values({ id: ids.coop, name: 'Eval cooperative', region: 'Karnataka', country: 'IN', createdAt: now });
  await db.insert(farmers).values({ id: ids.farmer, cooperativeId: ids.coop, name: 'Eval farmer', paypalEmail: 'farmer@farmproof.test', createdAt: now });
  await db.insert(plots).values({
    id: ids.plot,
    farmerId: ids.farmer,
    name: `Eval plot ${tag}`,
    country: 'IN',
    commodity: 'coffee',
    ring: RING,
    areaHa: 4.8,
    eudrStatus: scenario.eudr?.status ?? 'PASS',
    eudrCheck: { lossSince2021Ha: scenario.eudr?.lossHa ?? 0, source: 'Global Forest Watch', fetchedAt: new Date(now).toISOString() },
    createdAt: now,
  });
  await db.insert(contracts).values({
    id: ids.contract,
    buyerId: ids.buyer,
    cooperativeId: ids.coop,
    commodity: 'coffee',
    season: '2026-27',
    currency: 'USD',
    totalCents: 100_000,
    advanceCents: 40_000,
    escrowRemainingCents: 40_000,
    state: 'ACTIVE',
    createdAt: now,
  });
  await db.insert(milestones).values({
    id: ids.milestone,
    contractId: ids.contract,
    plotId: ids.plot,
    type: scenario.milestone,
    state: 'REVIEW',
    opensAt: now - 86_400_000,
    closesAt: now + 86_400_000,
    trancheCents: 4500,
    shares: [{ id: ids.farmer, weight: 1 }],
    decision: { kind: 'REVIEW', reasons: scenario.heldBecause },
    decidedAt: now,
  });

  const challengeId = randomUUID();
  await db.insert(challenges).values({ id: challengeId, plotId: ids.plot, milestoneType: scenario.milestone, code: 'K7Q2AB', issuedAt: now - 6 * 60_000, usedAt: now });
  const r = scenario.reading;
  await db.insert(evidence).values({
    id: randomUUID(),
    milestoneId: ids.milestone,
    challengeId,
    kind: 'PHOTO',
    sha256: photoSha,
    gps: [75.771, 13.321],
    oracle: r && {
      reading: { challengeCodeRead: r.codeRead, cropStage: r.cropStage, confidence: r.confidence, notes: r.notes, transcript: '', claimedMilestone: scenario.milestone },
      source: { kind: 'MODEL', model: 'gemini-3.5-flash-lite' },
      verdict: { codeMatch: r.codeRead === 'K7Q2AB', stageFits: r.stageFits, confidence: r.stageFits ? r.confidence : Math.min(r.confidence, 0.5) },
    },
    createdAt: now,
  });

  if (scenario.photoAlsoUsedOnAnotherPlot) {
    const other = await createScenario(db, { ...SCENARIOS[0], photoAlsoUsedOnAnotherPlot: false }, now - 86_400_000);
    await db.insert(evidence).values({ id: randomUUID(), milestoneId: other, kind: 'PHOTO', sha256: photoSha, gps: [75.771, 13.321], createdAt: now - 86_400_000 });
  }
  return ids.milestone;
}
