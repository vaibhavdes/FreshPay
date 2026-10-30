import { and, desc, eq, like } from 'drizzle-orm';
import type { Db } from '../db/client';
import { serialized } from '../db/lock';
import { contracts, paypalOps } from '../db/schema';
import { authorizationAction, reauthorizeDay } from '../engine/authorization';
import { paypalSdk } from '../paypal-sdk';
import { appendLedger } from './ledger';
import { runOp } from './ops';

// Keeps each delivery's balance authorization honoured until quality is checked: after every
// 3-day honour period PayPal is asked to reauthorize, up to the 29-day limit.
export async function sweepAuthorizations(db: Db, now = Date.now()) {
  const delivering = await db.select({ id: contracts.id }).from(contracts).where(eq(contracts.state, 'DELIVERING'));
  const results = [];
  for (const { id } of delivering) results.push(await serialized(`contract:${id}`, () => sweepContract(db, id, now)));
  return results;
}

async function sweepContract(db: Db, contractId: string, now: number) {
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  const [original] = await db
    .select()
    .from(paypalOps)
    .where(and(eq(paypalOps.key, `${contractId}/balance/authorize`), eq(paypalOps.status, 'COMPLETED')));
  if (contract.state !== 'DELIVERING' || !contract.balanceAuthorizationId || !original) return { contractId, action: 'NONE' as const };

  const [latest] = await db
    .select()
    .from(paypalOps)
    .where(and(like(paypalOps.key, `${contractId}/balance/reauthorize/%`), eq(paypalOps.status, 'COMPLETED')))
    .orderBy(desc(paypalOps.createdAt))
    .limit(1);
  const action = authorizationAction({ authorizedAt: original.createdAt, honouredSince: latest?.createdAt ?? original.createdAt, now });
  // An expired authorization can't be renewed; the buyer has to authorize the balance again.
  if (action !== 'REAUTHORIZE') return { contractId, action };

  const previous = contract.balanceAuthorizationId;
  const { op } = await runOp(
    db,
    { op: 'payments.reauthorize', key: `${contractId}/balance/reauthorize/${reauthorizeDay(original.createdAt, now)}`, now: () => now },
    async (requestId) => {
      const { result } = await paypalSdk().payments.reauthorizePayment({ authorizationId: previous, paypalRequestId: requestId });
      return { paypalId: result.id!, completed: true };
    },
  );
  await db.update(contracts).set({ balanceAuthorizationId: op.paypalId }).where(eq(contracts.id, contractId));
  await appendLedger(db, { kind: 'BALANCE_REAUTHORIZED', contractId, previous, authorizationId: op.paypalId }, now);
  return { contractId, action, authorizationId: op.paypalId };
}
