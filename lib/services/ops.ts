import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { paypalOps, webhookEvents } from '../db/schema';
import { publish } from '../events';
import { requestIdFor, routeError, type RoutedError } from '../paypal-errors';

export type Op = typeof paypalOps.$inferSelect;

export class PayPalOpFailed extends Error {
  readonly op: Op;
  readonly routed: RoutedError;

  constructor(op: Op, routed: RoutedError) {
    super(`${op.op} failed (${routed.route}: ${routed.issue})`);
    this.name = 'PayPalOpFailed';
    this.op = op;
    this.routed = routed;
  }
}

type CallResult = { paypalId: string; completed: boolean };

// Runs one PayPal mutation exactly once per business key. A completed op is returned as is;
// a pending or failed one is retried with the same PayPal-Request-Id, so PayPal dedupes it too.
export async function runOp(
  db: Db,
  { op, key, now = Date.now }: { op: string; key: string; now?: () => number },
  call: (requestId: string, opId: string) => Promise<CallResult>,
): Promise<{ op: Op; deduped: boolean }> {
  const [existing] = await db.select().from(paypalOps).where(eq(paypalOps.key, key));
  if (existing?.status === 'COMPLETED') return { op: existing, deduped: true };

  const requestId = requestIdFor(key);
  const startedAt = now();
  const row =
    existing ??
    (
      await db
        .insert(paypalOps)
        .values({ id: randomUUID(), op, key, requestId, status: 'PENDING', createdAt: startedAt, updatedAt: startedAt })
        .returning()
    )[0];
  await db
    .update(paypalOps)
    .set({ attempts: row.attempts + 1, updatedAt: startedAt })
    .where(eq(paypalOps.id, row.id));

  try {
    const { paypalId, completed } = await call(requestId, row.id);
    const finishedAt = now();
    // The webhook can beat the sync response; if it already arrived, it won the race.
    const [early] = await db
      .select({ receivedAt: webhookEvents.receivedAt })
      .from(webhookEvents)
      .where(eq(webhookEvents.resourceId, paypalId))
      .limit(1);
    const [updated] = await db
      .update(paypalOps)
      .set({
        paypalId,
        status: completed ? 'COMPLETED' : 'PENDING',
        syncMs: finishedAt - startedAt,
        webhookMs: early ? early.receivedAt - row.createdAt : null,
        learnedFrom: early ? 'WEBHOOK' : completed ? 'SYNC' : null,
        errorRoute: null,
        errorIssue: null,
        updatedAt: finishedAt,
      })
      .where(eq(paypalOps.id, row.id))
      .returning();
    publish({ type: 'paypal.op', opId: updated.id, op, status: updated.status, paypalId, learnedFrom: 'SYNC' });
    return { op: updated, deduped: false };
  } catch (error) {
    const routed = routeError(error);
    const [failed] = await db
      .update(paypalOps)
      .set({ status: 'FAILED', errorRoute: routed.route, errorIssue: routed.issue, debugId: routed.debugId ?? null, updatedAt: now() })
      .where(eq(paypalOps.id, row.id))
      .returning();
    publish({ type: 'paypal.op', opId: failed.id, op, status: 'FAILED', paypalId: failed.paypalId, learnedFrom: 'SYNC' });
    throw new PayPalOpFailed(failed, routed);
  }
}
