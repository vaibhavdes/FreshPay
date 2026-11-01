import { createHash } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { takeFault } from '../faults';
import { farmers, inputDealers, payoutItems } from '../db/schema';
import type { Allocation } from '../engine/splits';
import { paypalRequest } from '../paypal';
import { centsToValue } from '../paypal-sdk';
import { notFound } from './errors';
import { runOp } from './ops';

const payoutItemId = (key: string, payeeId: string) => `item-${createHash('sha256').update(`${key}|${payeeId}`).digest('hex').slice(0, 24)}`;

type Receiver = { receiver: string; type: 'EMAIL' | 'PAYPAL_ID' };

// Farmers who signed in with PayPal are paid by payer id; everyone else by email.
async function receiversOf(db: Db, ids: string[]): Promise<Map<string, Receiver>> {
  const people = await db.select({ id: farmers.id, email: farmers.paypalEmail, payerId: farmers.paypalPayerId }).from(farmers).where(inArray(farmers.id, ids));
  const suppliers = await db.select({ id: inputDealers.id, email: inputDealers.paypalEmail }).from(inputDealers).where(inArray(inputDealers.id, ids));
  return new Map<string, Receiver>([
    ...people.map((f): [string, Receiver] => [f.id, f.payerId ? { receiver: f.payerId, type: 'PAYPAL_ID' } : { receiver: f.email, type: 'EMAIL' }]),
    ...suppliers.map((d): [string, Receiver] => [d.id, { receiver: d.email, type: 'EMAIL' }]),
  ]);
}

// One PayPal Payouts batch per business key. Item ids derive from the key, so a retry neither
// duplicates payout items here nor pays twice at PayPal (same sender_batch_id and request id).
export async function sendPayoutBatch(db: Db, { key, payouts, note, now }: { key: string; payouts: Allocation[]; note: string; now: number }): Promise<string> {
  const receivers = await receiversOf(db, payouts.map((p) => p.id));
  const items = payouts
    .filter((p) => p.cents > 0)
    .map((p) => {
      const to = receivers.get(p.id);
      if (!to) throw notFound(`Payee ${p.id}`);
      return { id: payoutItemId(key, p.id), payeeId: p.id, receiver: to.receiver, recipientType: to.type, cents: p.cents };
    });

  // An armed test fault makes PayPal's sandbox fail these items (negative testing).
  const itemNote = takeFault('PAYOUT_ITEM_FAILS') ? 'ERRPYO002' : note;
  const { op } = await runOp(db, { op: 'payouts.batch', key }, async (requestId, opId) => {
    await db
      .insert(payoutItems)
      .values(items.map((i) => ({ id: i.id, payeeId: i.payeeId, receiver: i.receiver, cents: i.cents, opId, status: 'PENDING', updatedAt: now })))
      .onConflictDoNothing();
    const { batch_header } = await paypalRequest<{ batch_header: { payout_batch_id: string } }>('/v1/payments/payouts', {
      method: 'POST',
      requestId,
      body: {
        sender_batch_header: { sender_batch_id: requestId, email_subject: 'FarmProof farm payment', recipient_type: 'EMAIL' },
        items: items.map((i) => ({ recipient_type: i.recipientType, amount: { value: centsToValue(i.cents), currency: 'USD' }, receiver: i.receiver, sender_item_id: i.id, note: itemNote })),
      },
    });
    return { paypalId: batch_header.payout_batch_id, completed: true, cents: items.reduce((sum, i) => sum + i.cents, 0) };
  });
  return op.paypalId!;
}
