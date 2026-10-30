import { CaptureStatus, CheckoutPaymentIntent } from '@paypal/paypal-server-sdk';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { captureMock } from '../faults';
import { contracts } from '../db/schema';
import { transition } from '../engine/stateMachine';
import { publish } from '../events';
import { paypalSdk, usd } from '../paypal-sdk';
import { conflict, notFound } from './errors';
import { appendLedger } from './ledger';
import { runOp } from './ops';

async function getContract(db: Db, contractId: string) {
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  if (!contract) throw notFound(`Contract ${contractId}`);
  return contract;
}

// M0: the buyer funds the season advance with a PayPal CAPTURE order (approved via JS SDK v6).
export async function createAdvanceOrder(db: Db, contractId: string): Promise<string> {
  const contract = await getContract(db, contractId);
  if (contract.state !== 'DRAFT') throw conflict(`Contract ${contractId} is already ${contract.state}`);

  const { op } = await runOp(db, { op: 'orders.create', key: `${contractId}/advance/order` }, async (requestId) => {
    const { result } = await paypalSdk().orders.createOrder({
      paypalRequestId: requestId,
      body: {
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [
          { referenceId: contractId, description: `${contract.commodity} season advance ${contract.season}`, amount: usd(contract.advanceCents) },
        ],
      },
    });
    return { paypalId: result.id!, completed: true };
  });

  await db.update(contracts).set({ advanceOrderId: op.paypalId }).where(eq(contracts.id, contractId));
  return op.paypalId!;
}

export async function captureAdvance(db: Db, contractId: string, orderId: string, mockResponse?: string, now = Date.now()) {
  const contract = await getContract(db, contractId);
  if (contract.advanceOrderId !== orderId) throw conflict(`Order ${orderId} does not fund contract ${contractId}`);
  if (contract.state !== 'DRAFT') return contract;

  const { op } = await runOp(db, { op: 'orders.capture', key: `${contractId}/advance/capture` }, async (requestId) => {
    const { result } = await paypalSdk().orders.captureOrder({ id: orderId, paypalRequestId: requestId, paypalMockResponse: mockResponse ?? captureMock() });
    const capture = result.purchaseUnits?.[0]?.payments?.captures?.[0];
    if (!capture?.id) throw new Error(`Order ${orderId} returned no capture`);
    return { paypalId: capture.id, completed: capture.status === CaptureStatus.Completed, cents: contract.advanceCents };
  });
  if (op.status !== 'COMPLETED') return contract;

  const funded = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(contracts)
      .set({ state: transition(contract.state, 'FUND'), escrowRemainingCents: contract.advanceCents, advanceCaptureId: op.paypalId })
      .where(eq(contracts.id, contractId))
      .returning();
    await appendLedger(tx, { kind: 'ADVANCE_CAPTURED', contractId, captureId: op.paypalId, cents: contract.advanceCents }, now);
    return row;
  });
  publish({ type: 'contract', contractId, state: funded.state, escrowRemainingCents: funded.escrowRemainingCents });
  return funded;
}
