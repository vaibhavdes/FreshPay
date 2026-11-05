import { CheckoutPaymentIntent } from '@paypal/paypal-server-sdk';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { serialized } from '../db/lock';
import { serverErrorMock } from '../faults';
import { contracts, milestones, plots } from '../db/schema';
import { balanceDueCents, balancePayouts, captureForDelivery, type QcResult } from '../engine/settlement';
import { transition } from '../engine/stateMachine';
import { publish } from '../events';
import { paypalRequest } from '../paypal';
import { paypalSdk, usd, valueToCents } from '../paypal-sdk';
import { conflict, notFound } from './errors';
import { appendLedger } from './ledger';
import { runOp } from './ops';
import { sendPayoutBatch } from './payouts';

export async function contractWithPlots(db: Db, contractId: string) {
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  if (!contract) throw notFound(`Contract ${contractId}`);
  const plotIds = [...new Set((await db.select({ plotId: milestones.plotId }).from(milestones).where(eq(milestones.contractId, contractId))).map((m) => m.plotId))];
  const contractPlots = plotIds.length ? await db.select().from(plots).where(inArray(plots.id, plotIds)) : [];
  return { contract, plots: contractPlots };
}

export async function deliverySummary(db: Db, contractId: string) {
  const { contract, plots: contractPlots } = await contractWithPlots(db, contractId);
  return { contract, balanceDueCents: balanceDueCents(contractPlots, contract.advanceCents), excludedPlots: contractPlots.filter((p) => p.eudrStatus !== 'PASS').map((p) => p.name) };
}

// M4 step 1: the buyer authorizes the balance for compliant coffee when the lot ships.
export async function createBalanceOrder(db: Db, contractId: string): Promise<string> {
  const { contract, balanceDueCents: due } = await deliverySummary(db, contractId);
  if (contract.state !== 'ACTIVE') throw conflict(`Contract ${contractId} is ${contract.state}; the balance is authorized when an active season ships`);
  if (due === 0) throw conflict('Nothing is owed at delivery: the advance already covers the compliant coffee');

  const { op } = await runOp(db, { op: 'orders.create', key: `${contractId}/balance/order` }, async (requestId) => {
    const { result } = await paypalSdk().orders.createOrder({
      paypalRequestId: requestId,
      body: {
        intent: CheckoutPaymentIntent.Authorize,
        purchaseUnits: [{ referenceId: contractId, description: `${contract.commodity} season ${contract.season} balance on delivery`, amount: usd(due) }],
      },
    });
    return { paypalId: result.id!, completed: true };
  });
  await db.update(contracts).set({ balanceOrderId: op.paypalId }).where(eq(contracts.id, contractId));
  return op.paypalId!;
}

export async function authorizeBalance(db: Db, contractId: string, orderId: string, now = Date.now()) {
  const { contract } = await contractWithPlots(db, contractId);
  if (contract.balanceOrderId !== orderId) throw conflict(`Order ${orderId} is not the balance order for ${contractId}`);
  if (contract.state !== 'ACTIVE') return contract;

  let amountCents = 0;
  const { op } = await runOp(db, { op: 'orders.authorize', key: `${contractId}/balance/authorize` }, async (requestId) => {
    const { result } = await paypalSdk().orders.authorizeOrder({ id: orderId, paypalRequestId: requestId });
    const authorization = result.purchaseUnits?.[0]?.payments?.authorizations?.[0];
    if (!authorization?.id || !authorization.amount) throw new Error(`Order ${orderId} returned no authorization`);
    amountCents = valueToCents(authorization.amount.value);
    return { paypalId: authorization.id, completed: true };
  });

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(contracts)
      .set({ state: transition(contract.state, 'DISPATCH'), balanceAuthorizationId: op.paypalId, balanceAuthorizedCents: amountCents || contract.balanceAuthorizedCents })
      .where(eq(contracts.id, contractId))
      .returning();
    await appendLedger(tx, { kind: 'BALANCE_AUTHORIZED', contractId, authorizationId: op.paypalId, cents: row.balanceAuthorizedCents }, now);
    return row;
  });
  publish({ type: 'contract', contractId, state: updated.state, escrowRemainingCents: updated.escrowRemainingCents });
  return updated;
}

export type DeliveryInput = QcResult & {
  carrier: string;
  trackingNumber: string;
  grading?: { grade: string; suggestedPercent: number; inputHash: string; model: string };
};

// M4 step 2: QC decides how much of the authorization is captured. The final capture voids the
// rest, the shipment is tracked on the order, and the captured balance goes to farmers pro rata.
export async function settleDelivery(db: Db, contractId: string, input: DeliveryInput, now = Date.now()) {
  return serialized(`contract:${contractId}`, () => settleDeliveryNow(db, contractId, input, now));
}

async function settleDeliveryNow(db: Db, contractId: string, input: DeliveryInput, now: number) {
  const { contract, plots: contractPlots } = await contractWithPlots(db, contractId);
  if (contract.state !== 'DELIVERING' || !contract.balanceAuthorizationId || contract.balanceAuthorizedCents === null) {
    throw conflict(`Contract ${contractId} has no authorized balance waiting for delivery`);
  }
  const authorizationId = contract.balanceAuthorizationId;
  const { captureCents, voidCents } = captureForDelivery(contract.balanceAuthorizedCents, input);

  let captureId: string | null = null;
  if (captureCents > 0) {
    const { op } = await runOp(db, { op: 'payments.capture', key: `${contractId}/balance/capture` }, async (requestId) => {
      const { result } = await paypalSdk().payments.captureAuthorizedPayment({
        authorizationId,
        paypalRequestId: requestId,
        paypalMockResponse: serverErrorMock(contractId),
        body: { amount: usd(captureCents), finalCapture: true },
      });
      return { paypalId: result.id!, completed: true, cents: captureCents };
    });
    captureId = op.paypalId;
  } else {
    await runOp(db, { op: 'payments.void', key: `${contractId}/balance/void` }, async (requestId) => {
      await paypalSdk().payments.voidPayment({ authorizationId, paypalRequestId: requestId });
      return { paypalId: authorizationId, completed: true };
    });
  }
  await appendLedger(db, { kind: 'BALANCE_CAPTURED', contractId, captureId, captureCents, voidCents, qc: { deliveredKg: input.deliveredKg, acceptedKg: input.acceptedKg, qualityPercent: input.qualityPercent, ...(input.grading && { aiGrading: input.grading }) } }, now);

  if (captureId) {
    const capture = captureId;
    // The SDK's tracking call takes no PayPal-Request-Id, so this one goes over REST.
    await runOp(db, { op: 'orders.track', key: `${contractId}/balance/track` }, async (requestId) => {
      const order = await paypalRequest<{ id?: string }>(`/v2/checkout/orders/${contract.balanceOrderId}/track`, {
        method: 'POST',
        requestId,
        body: { capture_id: capture, tracking_number: input.trackingNumber, carrier: 'OTHER', carrier_name_other: input.carrier, notify_payer: false },
      });
      return { paypalId: order.id ?? capture, completed: true };
    });
  }

  const batchId =
    captureCents > 0
      ? await sendPayoutBatch(db, { key: `${contractId}/balance/payout`, payouts: balancePayouts(captureCents, contractPlots), note: `Balance for delivered coffee, season ${contract.season}`, now })
      : null;

  const settled = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(contracts)
      .set({
        state: transition('DELIVERING', 'SETTLE'),
        balanceCaptureId: captureId,
        balanceCapturedCents: captureCents,
        deliveredKg: input.deliveredKg,
        acceptedKg: input.acceptedKg,
        qualityPercent: input.qualityPercent,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
      })
      .where(eq(contracts.id, contractId))
      .returning();
    await appendLedger(tx, { kind: 'SETTLED', contractId, captureId, payoutBatchId: batchId }, now);
    return row;
  });
  publish({ type: 'contract', contractId, state: settled.state, escrowRemainingCents: settled.escrowRemainingCents });
  return { contract: settled, captureCents, voidCents, captureId, payoutBatchId: batchId };
}
