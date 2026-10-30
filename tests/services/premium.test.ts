import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import { contracts, ledgerReceipts, mandates, paypalOps, premiums } from '@/lib/db/schema';
import { issueChallenge } from '@/lib/services/challenges';
import { verifyLedger } from '@/lib/services/ledger';
import { submitClaim } from '@/lib/services/milestones';
import { freshDb, NOW, seed, stubPayPal, type PayPalCall } from '../helpers';

const sdk = vi.hoisted(() => ({ createOrder: vi.fn(), captureOrder: vi.fn() }));

vi.mock('@/lib/paypal-sdk', async (original) => ({
  ...(await original<typeof import('@/lib/paypal-sdk')>()),
  paypalSdk: () => ({ orders: sdk, payments: {} }),
}));

const { accrueForVerifiedPlot, capturePremiumOrder, chargePremiumsWithVault, createPremiumOrder, setMandate, startVaultSetup } = await import('@/lib/services/premium');

let db: Db;

beforeEach(async () => {
  db = await freshDb();
  await seed(db);
  sdk.createOrder.mockResolvedValue({ result: { id: 'ORDER-PREMIUM' } });
  sdk.captureOrder.mockResolvedValue({ result: { purchaseUnits: [{ payments: { captures: [{ id: 'CAPTURE-PREMIUM', status: 'COMPLETED' }] } }] } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const payoutOrOrder = (call: PayPalCall) =>
  call.url.endsWith('/v1/payments/payouts')
    ? Response.json({ batch_header: { payout_batch_id: 'BATCH-PREMIUM' } }, { status: 201 })
    : Response.json({ id: 'ORDER-VAULT', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAPTURE-VAULT' }] } }] }, { status: 201 });

describe('traceability premium', () => {
  it('accrues a premium when a plot is verified, within the mandate', async () => {
    stubPayPal(() => Response.json({ batch_header: { payout_batch_id: 'BATCH-1' } }, { status: 201 }));
    await setMandate(db, 'contract-1', { perPlotCents: 4000, capCents: 4000 }, NOW);

    const challenge = await issueChallenge(db, 'plot-1', 'PLOT_VERIFIED', NOW - 60_000);
    await submitClaim(db, {
      milestoneId: 'm-verified',
      claimedMilestone: 'PLOT_VERIFIED',
      challengeId: challenge.id,
      challengeCode: challenge.code,
      gps: [75.771, 13.321],
      vision: { codeMatch: true, confidence: 0.95 },
      evidence: [],
      now: NOW,
    });

    expect(await db.select().from(premiums)).toEqual([expect.objectContaining({ plotId: 'plot-1', farmerId: 'farmer-1', cents: 4000, state: 'OWED' })]);
    expect(await accrueForVerifiedPlot(db, { contractId: 'contract-1', plotId: 'plot-1', farmerId: 'farmer-1' }, NOW)).toEqual({ kind: 'SKIP', reason: 'MANDATE_EXCEEDED' });
  });

  it('collects owed premiums in one buyer-approved order and pays the farmers', async () => {
    const calls = stubPayPal(payoutOrOrder);
    await setMandate(db, 'contract-1', { perPlotCents: 4000, capCents: 40_000 }, NOW);
    await accrueForVerifiedPlot(db, { contractId: 'contract-1', plotId: 'plot-1', farmerId: 'farmer-1' }, NOW);

    expect(await createPremiumOrder(db, 'contract-1')).toBe('ORDER-PREMIUM');
    expect(sdk.createOrder.mock.calls[0][0].body.purchaseUnits[0].amount).toEqual({ currencyCode: 'USD', value: '40.00' });
    expect(await capturePremiumOrder(db, 'contract-1', 'ORDER-PREMIUM', NOW)).toEqual({ state: 'PAID', payoutBatchId: 'BATCH-PREMIUM' });

    expect(calls.find((c) => c.url.endsWith('/v1/payments/payouts'))?.body).toMatchObject({ items: [{ receiver: 'farmer1@example.com', amount: { value: '40.00' } }] });
    expect(await db.select({ state: premiums.state }).from(premiums)).toEqual([{ state: 'PAID' }]);
    expect((await db.select().from(mandates))[0].usedCents).toBe(4000);
    expect(await verifyLedger(db)).toEqual({ ok: true });
  });

  it('charges owed premiums on the saved PayPal without the buyer present', async () => {
    const calls = stubPayPal(payoutOrOrder);
    const mandate = await setMandate(db, 'contract-1', { perPlotCents: 4000, capCents: 40_000 }, NOW);
    await db.update(mandates).set({ vaultTokenId: 'TOKEN-1', vaultStatus: 'ACTIVE' }).where(eq(mandates.id, mandate.id));
    await accrueForVerifiedPlot(db, { contractId: 'contract-1', plotId: 'plot-1', farmerId: 'farmer-1' }, NOW);

    expect(await chargePremiumsWithVault(db, 'contract-1', NOW)).toBe('BATCH-PREMIUM');
    expect(calls[0].body).toMatchObject({ intent: 'CAPTURE', payment_source: { paypal: { vault_id: 'TOKEN-1' } } });
    expect((await db.select().from(ledgerReceipts)).map((r) => r.payload.kind)).toEqual(['PREMIUM_MANDATE', 'PREMIUM_PAID']);
    const [charge] = await db.select().from(paypalOps).where(eq(paypalOps.op, 'orders.vault-charge'));
    expect(charge.paypalId).toBe('CAPTURE-VAULT');
  });

  it('falls back to checkout when the merchant cannot vault PayPal', async () => {
    stubPayPal(() =>
      Response.json({ name: 'NOT_AUTHORIZED', details: [{ issue: 'NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE' }] }, { status: 403 }),
    );
    await setMandate(db, 'contract-1', { perPlotCents: 4000, capCents: 40_000 }, NOW);

    expect(await startVaultSetup(db, 'contract-1', 'https://x/return', 'https://x/cancel')).toEqual({ approveUrl: null });
    expect((await db.select().from(mandates))[0].vaultStatus).toBe('UNAVAILABLE');
    expect((await db.select().from(contracts))[0].state).toBe('FUNDED');
  });
});
