import { createHash, randomUUID } from 'node:crypto';
import { CaptureStatus, CheckoutPaymentIntent } from '@paypal/paypal-server-sdk';
import { and, eq, inArray, sum } from 'drizzle-orm';
import type { Db } from '../db/client';
import { serialized } from '../db/lock';
import { contracts, mandates, premiums } from '../db/schema';
import { accruePremium } from '../engine/premium';
import { publish } from '../events';
import { PayPalApiError, paypalRequest } from '../paypal';
import { paypalSdk, usd } from '../paypal-sdk';
import { conflict, notFound } from './errors';
import { appendLedger } from './ledger';
import { runOp } from './ops';
import { sendPayoutBatch } from './payouts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export async function mandateFor(db: Db | Tx, contractId: string) {
  const [mandate] = await db.select().from(mandates).where(eq(mandates.contractId, contractId));
  return mandate ?? null;
}

export async function setMandate(db: Db, contractId: string, { perPlotCents, capCents }: { perPlotCents: number; capCents: number }, now = Date.now()) {
  const existing = await mandateFor(db, contractId);
  if (existing) {
    const [row] = await db.update(mandates).set({ perPlotCents, capCents }).where(eq(mandates.id, existing.id)).returning();
    return row;
  }
  const [row] = await db.insert(mandates).values({ id: randomUUID(), contractId, perPlotCents, capCents, createdAt: now }).returning();
  await appendLedger(db, { kind: 'PREMIUM_MANDATE', contractId, perPlotCents, capCents }, now);
  return row;
}

// Called when a plot passes verification: the farmer earns the premium if the mandate has room.
export async function accrueForVerifiedPlot(db: Db | Tx, { contractId, plotId, farmerId }: { contractId: string; plotId: string; farmerId: string }, now = Date.now()) {
  const mandate = await mandateFor(db, contractId);
  const [{ accrued }] = await db
    .select({ accrued: sum(premiums.cents).mapWith(Number) })
    .from(premiums)
    .where(eq(premiums.contractId, contractId));
  const decision = accruePremium(mandate && { perPlotCents: mandate.perPlotCents, capCents: mandate.capCents, accruedCents: accrued ?? 0 });
  if (decision.kind === 'ACCRUE') {
    await db.insert(premiums).values({ id: randomUUID(), contractId, plotId, farmerId, cents: decision.cents, state: 'OWED', createdAt: now }).onConflictDoNothing();
    publish({ type: 'premium', contractId, state: 'OWED' });
  }
  return decision;
}

const owed = (db: Db, contractId: string) => db.select().from(premiums).where(and(eq(premiums.contractId, contractId), eq(premiums.state, 'OWED')));

// The same set of owed premiums always maps to the same PayPal request, so retries never double-charge.
const batchKey = (contractId: string, kind: string, ids: string[]) =>
  `${contractId}/premium/${kind}/${createHash('sha256').update([...ids].sort().join(',')).digest('hex').slice(0, 16)}`;

async function payPremiums(db: Db, contractId: string, orderId: string, now: number) {
  const charged = await db.select().from(premiums).where(and(eq(premiums.contractId, contractId), eq(premiums.orderId, orderId), eq(premiums.state, 'CHARGED')));
  if (!charged.length) return null;

  const byFarmer = new Map<string, number>();
  for (const p of charged) byFarmer.set(p.farmerId, (byFarmer.get(p.farmerId) ?? 0) + p.cents);
  const total = charged.reduce((s, p) => s + p.cents, 0);

  const batchId = await sendPayoutBatch(db, {
    key: `${contractId}/premium/payout/${orderId}`,
    payouts: [...byFarmer].map(([id, cents]) => ({ id, cents })),
    note: 'Traceability premium for your verified plot',
    now,
  });
  await db.transaction(async (tx) => {
    await tx.update(premiums).set({ state: 'PAID' }).where(inArray(premiums.id, charged.map((p) => p.id)));
    const mandate = await mandateFor(tx, contractId);
    if (mandate) await tx.update(mandates).set({ usedCents: mandate.usedCents + total }).where(eq(mandates.id, mandate.id));
    await appendLedger(tx, { kind: 'PREMIUM_PAID', contractId, orderId, payoutBatchId: batchId, cents: total }, now);
  });
  publish({ type: 'premium', contractId, state: 'PAID' });
  return batchId;
}

async function markCharged(db: Db, ids: string[], orderId: string) {
  await db.update(premiums).set({ state: 'CHARGED', orderId }).where(inArray(premiums.id, ids));
}

const isVaultNotEnabled = (error: unknown) => error instanceof PayPalApiError && error.body.includes('NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE');

// Vault path, step 1: the buyer saves PayPal for premiums, with no purchase. If the merchant
// account cannot vault PayPal, the mandate falls back to buyer-approved premium orders.
export async function startVaultSetup(db: Db, contractId: string, returnUrl: string, cancelUrl: string) {
  const mandate = await mandateFor(db, contractId);
  if (!mandate) throw conflict('Set the premium mandate before saving PayPal for it');
  try {
    const token = await paypalRequest<{ id: string; links?: { href: string; rel: string }[] }>('/v3/vault/setup-tokens', {
      method: 'POST',
      requestId: `agritranche-vault-setup-${mandate.id}-${Date.now()}`,
      body: {
        payment_source: {
          paypal: {
            description: 'FarmProof good-practice bonus mandate',
            usage_pattern: 'UNSCHEDULED_POSTPAID',
            usage_type: 'MERCHANT',
            customer_type: 'CONSUMER',
            permit_multiple_payment_tokens: false,
            experience_context: { return_url: returnUrl, cancel_url: cancelUrl, shipping_preference: 'NO_SHIPPING' },
          },
        },
      },
    });
    const approve = token.links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action')?.href;
    if (!approve) throw new Error('PayPal returned no approval link for the mandate');
    await db.update(mandates).set({ setupTokenId: token.id, vaultStatus: 'PENDING' }).where(eq(mandates.id, mandate.id));
    return { approveUrl: approve };
  } catch (error) {
    if (!isVaultNotEnabled(error)) throw error;
    await db.update(mandates).set({ vaultStatus: 'UNAVAILABLE' }).where(eq(mandates.id, mandate.id));
    return { approveUrl: null };
  }
}

export async function completeVaultSetup(db: Db, contractId: string, now = Date.now()) {
  const mandate = await mandateFor(db, contractId);
  if (!mandate?.setupTokenId) throw notFound(`Pending PayPal mandate for ${contractId}`);
  const token = await paypalRequest<{ id: string }>('/v3/vault/payment-tokens', {
    method: 'POST',
    requestId: `agritranche-vault-token-${mandate.setupTokenId}`,
    body: { payment_source: { token: { id: mandate.setupTokenId, type: 'SETUP_TOKEN' } } },
  });
  await db.update(mandates).set({ vaultTokenId: token.id, vaultStatus: 'ACTIVE' }).where(eq(mandates.id, mandate.id));
  await appendLedger(db, { kind: 'PREMIUM_VAULT_SAVED', contractId, paymentTokenId: token.id }, now);
  return token.id;
}

// Vault path, step 2: charge every owed premium on the saved PayPal, without the buyer present.
export async function chargePremiumsWithVault(db: Db, contractId: string, now = Date.now()) {
  return serialized(`contract:${contractId}`, () => chargeWithVaultNow(db, contractId, now));
}

async function chargeWithVaultNow(db: Db, contractId: string, now: number) {
  const mandate = await mandateFor(db, contractId);
  const due = await owed(db, contractId);
  if (!mandate?.vaultTokenId || mandate.vaultStatus !== 'ACTIVE' || !due.length) return null;

  const total = due.reduce((s, p) => s + p.cents, 0);
  const vaultId = mandate.vaultTokenId;
  try {
    const { op } = await runOp(db, { op: 'orders.vault-charge', key: batchKey(contractId, 'vault', due.map((p) => p.id)) }, async (requestId) => {
      const order = await paypalRequest<{ id: string; status: string; purchase_units?: { payments?: { captures?: { id: string }[] } }[] }>('/v2/checkout/orders', {
        method: 'POST',
        requestId,
        body: {
          intent: 'CAPTURE',
          purchase_units: [{ reference_id: contractId, description: `Traceability premium, ${due.length} verified plot(s)`, amount: { currency_code: 'USD', value: usd(total).value } }],
          payment_source: { paypal: { vault_id: vaultId } },
        },
      });
      const captured =
        order.status === 'COMPLETED'
          ? order
          : await paypalRequest<typeof order>(`/v2/checkout/orders/${order.id}/capture`, { method: 'POST', body: {}, requestId: `${requestId}-capture` });
      // Reconciliation matches PayPal's transactions by capture id, not order id.
      const captureId = captured.purchase_units?.[0]?.payments?.captures?.[0]?.id;
      if (!captureId) throw new Error(`Order ${order.id} returned no capture`);
      return { paypalId: captureId, completed: true, cents: total };
    });
    await markCharged(db, due.map((p) => p.id), op.paypalId!);
    return payPremiums(db, contractId, op.paypalId!, now);
  } catch (error) {
    if (!isVaultNotEnabled(error)) throw error;
    await db.update(mandates).set({ vaultStatus: 'UNAVAILABLE' }).where(eq(mandates.id, mandate.id));
    return null;
  }
}

// Fallback: the buyer approves one PayPal order covering every owed premium.
export async function createPremiumOrder(db: Db, contractId: string): Promise<string> {
  const due = await owed(db, contractId);
  if (!due.length) throw conflict('No premiums are owed right now');
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  const total = due.reduce((s, p) => s + p.cents, 0);

  const { op } = await runOp(db, { op: 'orders.create', key: batchKey(contractId, 'order', due.map((p) => p.id)) }, async (requestId) => {
    const { result } = await paypalSdk().orders.createOrder({
      paypalRequestId: requestId,
      body: {
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [{ referenceId: contractId, description: `Traceability premium, ${due.length} verified plot(s), season ${contract.season}`, amount: usd(total) }],
      },
    });
    return { paypalId: result.id!, completed: true };
  });
  await db.update(premiums).set({ orderId: op.paypalId }).where(inArray(premiums.id, due.map((p) => p.id)));
  return op.paypalId!;
}

export async function capturePremiumOrder(db: Db, contractId: string, orderId: string, now = Date.now()) {
  return serialized(`contract:${contractId}`, () => captureOrderNow(db, contractId, orderId, now));
}

async function captureOrderNow(db: Db, contractId: string, orderId: string, now: number) {
  const pending = await db.select().from(premiums).where(and(eq(premiums.contractId, contractId), eq(premiums.orderId, orderId)));
  if (!pending.length) throw conflict(`Order ${orderId} does not pay premiums on ${contractId}`);

  const { op } = await runOp(db, { op: 'orders.capture', key: `${contractId}/premium/capture/${orderId}` }, async (requestId) => {
    const { result } = await paypalSdk().orders.captureOrder({ id: orderId, paypalRequestId: requestId });
    const capture = result.purchaseUnits?.[0]?.payments?.captures?.[0];
    if (!capture?.id) throw new Error(`Order ${orderId} returned no capture`);
    return { paypalId: capture.id, completed: capture.status === CaptureStatus.Completed, cents: pending.reduce((sum, p) => sum + p.cents, 0) };
  });
  if (op.status !== 'COMPLETED') return { state: 'PENDING' as const };

  await markCharged(db, pending.filter((p) => p.state === 'OWED').map((p) => p.id), orderId);
  const batchId = await payPremiums(db, contractId, orderId, now);
  return { state: 'PAID' as const, payoutBatchId: batchId };
}
