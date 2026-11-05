import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from '../db/client';
import { billFingerprints, buyers, challenges, contracts, cooperatives, evidence, farmers, inputDealers, milestones, plots } from '../db/schema';
import { billFingerprint } from '../engine/fraud';
import type { Bill, GateDecision } from '../engine/gate';
import type { LngLat } from '../engine/geo';
import { verifyWebhook } from '../webhooks';
import { issueChallenge } from './challenges';
import { submitClaim, type ClaimInput } from './milestones';

// Runs real cheating attempts through the same checks that pay farmers, on a throwaway season
// in its own database. Claims run as dry runs: nothing is recorded and PayPal is never asked to pay.

export type CheatOutcome = 'WOULD_PAY' | 'REFUSED' | 'HELD' | 'NOT_RUN';
export type CheatResult = { id: string; title: string; attempt: string; outcome: CheatOutcome; caught: string; reasons: string[]; cents: number };

const DAY = 86_400_000;
const RING: LngLat[] = [
  [75.889, 12.3201],
  [75.8934, 12.3201],
  [75.8934, 12.3253],
  [75.889, 12.3253],
];
const ON_FARM: LngLat = [75.8912, 12.3227];
const SHOP = 'Malnad Agro Inputs';
const PHOTO = 'a5a5c3c3e1e1f0f0';

type Setup = { db: Db; now: number };
type Attempt = { milestoneId: string; plotId: string; type: ClaimInput['claimedMilestone']; claim?: Partial<ClaimInput> };

async function seed(db: Db, now: number) {
  const window = { opensAt: now - 10 * DAY, closesAt: now + 30 * DAY };
  await db.insert(buyers).values({ id: 'b', name: 'Caffè Ventoro S.p.A.', country: 'IT', paypalEmail: 'buyer@farmproof.test', createdAt: now });
  await db.insert(cooperatives).values({ id: 'c', name: 'Malnad Coffee Growers FPO', region: 'Karnataka', country: 'IN', createdAt: now });
  await db.insert(farmers).values([
    { id: 'lakshmi', cooperativeId: 'c', name: 'Lakshmi Gowda', paypalEmail: 'lakshmi@farmproof.test', createdAt: now },
    { id: 'savitha', cooperativeId: 'c', name: 'Savitha Poojary', paypalEmail: 'savitha@farmproof.test', createdAt: now },
  ]);
  await db.insert(inputDealers).values({ id: 'shop', name: SHOP, kind: 'INPUTS', paypalEmail: 'shop@farmproof.test', createdAt: now });
  const plot = (id: string, farmerId: string, eudrStatus: 'PASS' | 'FAIL', offset: number) => ({
    id,
    farmerId,
    dealerId: 'shop',
    name: id,
    country: 'IN',
    commodity: 'coffee',
    ring: RING.map(([lng, lat]) => [lng + offset, lat] as LngLat),
    areaHa: 3.9,
    eudrStatus,
    createdAt: now,
  });
  await db.insert(plots).values([plot('hill', 'lakshmi', 'PASS', 0), plot('clearing', 'savitha', 'FAIL', 0.02)]);
  await db.insert(contracts).values({ id: 'k', buyerId: 'b', cooperativeId: 'c', commodity: 'coffee', season: '2026-27', currency: 'USD', totalCents: 3_350_600, advanceCents: 1_144_600, escrowRemainingCents: 1_144_600, state: 'ACTIVE', createdAt: now });
  const rule = { kind: 'BILL' as const, lines: [{ kind: 'INPUTS' as const, capCents: 98_000, payeeId: 'shop' }], labourCents: 36_300, farmerId: 'lakshmi' };
  const stage = (id: string, plotId: string, type: Attempt['type'], state: 'PENDING' | 'RELEASED', farmerId: string, bill = false) => ({
    id,
    contractId: 'k',
    plotId,
    type,
    state,
    ...window,
    trancheCents: bill ? 98_000 + 36_300 : 2500,
    shares: [{ id: farmerId, weight: 1 }],
    rule: bill ? { ...rule, farmerId } : null,
  });
  await db.insert(milestones).values([
    stage('hill-mapped', 'hill', 'PLOT_VERIFIED', 'RELEASED', 'lakshmi'),
    stage('hill-inputs', 'hill', 'INPUTS', 'PENDING', 'lakshmi', true),
    stage('hill-harvest', 'hill', 'HARVEST', 'PENDING', 'lakshmi'),
    stage('clearing-mapped', 'clearing', 'PLOT_VERIFIED', 'PENDING', 'savitha'),
  ]);
  // An earlier claim on Savitha's farm, with the photo and the bill a cheat will try to use again.
  await db.insert(evidence).values({ id: randomUUID(), milestoneId: 'clearing-mapped', challengeId: null, kind: 'PHOTO', sha256: 'f'.repeat(64), photoHash: PHOTO, gps: ON_FARM, oracle: null, createdAt: now - 2 * DAY });
  await db.insert(billFingerprints).values({ contractId: 'k', fingerprint: billFingerprint(paidBill)!, milestoneId: 'clearing-mapped', createdAt: now - 2 * DAY });
}

const today = (now: number) => new Date(now).toISOString().slice(0, 10);
const bill = (now: number, over: Partial<Bill> = {}): Bill => ({ kind: 'INPUTS', cents: 64_000, payeeId: 'shop', issuer: SHOP, number: 'MAI/2026/0412', date: today(now), ...over });
const paidBill: Bill = { kind: 'INPUTS', cents: 51_500, payeeId: 'shop', issuer: SHOP, number: 'MAI/2026/0388', date: '2026-10-28' };

async function attempt({ db, now }: Setup, a: Attempt): Promise<GateDecision> {
  const challenge = await issueChallenge(db, a.plotId, a.type, now - 60_000);
  return (
    await submitClaim(db, {
      milestoneId: a.milestoneId,
      claimedMilestone: a.type,
      challengeId: challenge.id,
      challengeCode: challenge.code,
      gps: ON_FARM,
      vision: { codeMatch: true, confidence: 0.94 },
      evidence: [{ kind: 'PHOTO', sha256: randomUUID().replace(/-/g, '').padEnd(64, '0'), photoHash: '0f0f3c3c5a5a9696' }],
      bills: a.type === 'INPUTS' ? [bill(now)] : null,
      now,
      dryRun: true,
      ...a.claim,
    })
  ).decision;
}

const inputs = (claim: Partial<ClaimInput> = {}): Attempt => ({ milestoneId: 'hill-inputs', plotId: 'hill', type: 'INPUTS', claim });

type Cheat = { id: string; title: string; attempt: string; caught: string; run: (s: Setup) => Promise<GateDecision | 'NOT_RUN' | 'REFUSED'> };

const CHEATS: Cheat[] = [
  { id: 'honest', title: 'An honest claim', attempt: "Today's code, on the farm, with the shop's bill for this stage.", caught: 'Passes every check, so it would be paid. (Dry run: nothing is sent.)', run: (s) => attempt(s, inputs()) },
  {
    id: 'reused-photo',
    title: 'Reuse an old photo',
    attempt: "Send the same picture another farm already sent this season.",
    caught: 'The photo matches one already on record, so a person checks it first.',
    run: (s) => attempt(s, inputs({ evidence: [{ kind: 'PHOTO', sha256: 'e'.repeat(64), photoHash: PHOTO }] })),
  },
  { id: 'wrong-code', title: 'Write a made-up code', attempt: 'The paper in the photo shows a code the app never issued.', caught: "The AI reads the code in the photo and it isn't today's code.", run: (s) => attempt(s, inputs({ vision: { codeMatch: false, confidence: 0.92 } })) },
  { id: 'old-code', title: "Use another day's code", attempt: 'Type in a code that belongs to a different request.', caught: 'Each code is signed for one farm, one stage and 15 minutes.', run: (s) => attempt(s, inputs({ challengeCode: 'ZZZZZZ' })) },
  {
    id: 'replay',
    title: 'Send the same proof twice',
    attempt: 'Replay a claim whose code was already used.',
    caught: 'A code works once. The second send is refused.',
    run: async (s) => {
      const c = await issueChallenge(s.db, 'hill', 'INPUTS', s.now - 120_000);
      await s.db.update(challenges).set({ usedAt: s.now - 60_000 }).where(eq(challenges.id, c.id));
      return attempt(s, inputs({ challengeId: c.id, challengeCode: c.code }));
    },
  },
  { id: 'away', title: 'Claim from home', attempt: 'Send the proof from a phone 4 km away from the farm.', caught: 'The phone has to be inside the mapped farm boundary.', run: (s) => attempt(s, inputs({ gps: [75.93, 12.3227] })) },
  { id: 'paid-bill', title: 'Reuse a paid bill', attempt: 'Send a fertiliser bill that was already paid on another farm.', caught: 'Every paid bill is fingerprinted; the same bill is never paid twice.', run: (s) => attempt(s, inputs({ bills: [paidBill] })) },
  { id: 'other-shop', title: "Use someone else's bill", attempt: "Send a bill printed by a different shop, but ask for the money to go to this one.", caught: "The name on the bill doesn't match the shop being paid, so the officer checks it.", run: (s) => attempt(s, inputs({ bills: [bill(s.now, { issuer: 'Sharma Fertiliser Depot', number: 'SFD-7781' })] })) },
  { id: 'old-bill', title: 'Use last year\'s bill', attempt: 'Send a real bill from the previous season.', caught: "The bill's date is outside this stage, so the officer checks it.", run: (s) => attempt(s, inputs({ bills: [bill(s.now, { date: '2025-06-14', number: 'MAI/2025/0091' })] })) },
  { id: 'skip', title: 'Skip ahead to harvest', attempt: 'Claim the harvest payment before fertiliser was even proven.', caught: 'Stages are paid in order.', run: (s) => attempt(s, { milestoneId: 'hill-harvest', plotId: 'hill', type: 'HARVEST' }) },
  { id: 'forest', title: 'Farm on cleared forest', attempt: 'A perfect photo from a farm where forest was cut after 2020.', caught: 'Satellite data shows tree cover lost since 2020; the farm is not paid, whatever the photo shows.', run: (s) => attempt(s, { milestoneId: 'clearing-mapped', plotId: 'clearing', type: 'PLOT_VERIFIED', claim: { gps: [75.9112, 12.3227] } }) },
  {
    id: 'webhook',
    title: 'Fake a PayPal message',
    attempt: 'Post a forged "payout succeeded" webhook to the app.',
    caught: "PayPal's own signature check says it isn't from PayPal, so it's ignored.",
    run: async () => {
      const headers = new Headers({
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77',
        'paypal-transmission-id': randomUUID(),
        'paypal-transmission-sig': Buffer.from('forged').toString('base64'),
        'paypal-transmission-time': new Date().toISOString(),
      });
      const body = JSON.stringify({ id: `WH-${randomUUID()}`, event_type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', resource: { payout_item_id: 'FAKE' } });
      try {
        return (await verifyWebhook(headers, body)) ? 'NOT_RUN' : 'REFUSED';
      } catch {
        return 'NOT_RUN';
      }
    },
  },
];

const outcomeOf = (d: GateDecision): CheatOutcome => (d.kind === 'RELEASE' ? 'WOULD_PAY' : d.kind === 'REVIEW' ? 'HELD' : 'REFUSED');

export async function runCheats(now = Date.now()): Promise<CheatResult[]> {
  const file = join(tmpdir(), `farmproof-cheats-${randomUUID()}.db`);
  const db = await openDb(`file:${file}`);
  try {
    await seed(db, now);
    const results: CheatResult[] = [];
    for (const cheat of CHEATS) {
      const { run, ...info } = cheat;
      const decision = await run({ db, now });
      if (typeof decision === 'string') results.push({ ...info, outcome: decision, reasons: [], cents: 0 });
      else
        results.push({
          ...info,
          outcome: outcomeOf(decision),
          reasons: 'reasons' in decision ? decision.reasons : [],
          cents: decision.kind === 'RELEASE' ? decision.payouts.reduce((sum, p) => sum + p.cents, 0) : 0,
        });
    }
    return results;
  } finally {
    db.$client.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
  }
}
