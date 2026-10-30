import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { contracts } from '../db/schema';
import { evaluateForceMajeure } from '../engine/force-majeure';
import { centroid } from '../engine/geo';
import { transition } from '../engine/stateMachine';
import { publish } from '../events';
import { checkWeather, type WeatherCheck } from '../oracles/weather';
import { paypalSdk, usd } from '../paypal-sdk';
import { contractWithPlots } from './delivery';
import { conflict } from './errors';
import { appendLedger } from './ledger';
import { runOp } from './ops';

export type WeatherChecker = (location: readonly [number, number], startDate: string, endDate: string) => Promise<WeatherCheck>;

// Verified weather that ended the season refunds the unearned advance on its original capture.
// A delivery authorization still outstanding is voided too, so the buyer is never left holding one.
export async function declareForceMajeure(
  db: Db,
  contractId: string,
  { startDate, endDate }: { startDate: string; endDate: string },
  { check = checkWeather, now = Date.now() }: { check?: WeatherChecker; now?: number } = {},
) {
  const { contract, plots: all } = await contractWithPlots(db, contractId);
  const plots = all.filter((p) => p.eudrStatus === 'PASS');

  const findings = await Promise.all(plots.map(async (p) => ({ plot: p, weather: await check(centroid(p.ring), startDate, endDate) })));
  const decision = evaluateForceMajeure({
    state: contract.state,
    escrowRemainingCents: contract.escrowRemainingCents,
    plots: findings.map(({ plot, weather }) => ({ plotId: plot.id, valueCents: plot.valueCents, event: weather.event })),
  });
  const evidence = { startDate, endDate, plots: findings.map(({ plot, weather }) => ({ plotId: plot.id, plot: plot.name, ...weather })) };
  if (decision.kind === 'REJECT') return { decision, evidence, contract };

  if (!contract.advanceCaptureId) throw conflict(`Contract ${contractId} has no captured advance to refund`);
  const captureId = contract.advanceCaptureId;
  const { op: refund } = await runOp(db, { op: 'payments.refund', key: `${contractId}/force-majeure/refund` }, async (requestId) => {
    const { result } = await paypalSdk().payments.refundCapturedPayment({
      captureId,
      paypalRequestId: requestId,
      body: { amount: usd(decision.refundCents), noteToPayer: `Unearned season advance returned after verified ${findings.find((f) => f.weather.event !== 'NONE')?.weather.event.toLowerCase()}` },
    });
    return { paypalId: result.id!, completed: true, cents: decision.refundCents };
  });

  if (contract.state === 'DELIVERING' && contract.balanceAuthorizationId) {
    const authorizationId = contract.balanceAuthorizationId;
    await runOp(db, { op: 'payments.void', key: `${contractId}/balance/void` }, async (requestId) => {
      await paypalSdk().payments.voidPayment({ authorizationId, paypalRequestId: requestId });
      return { paypalId: authorizationId, completed: true };
    });
  }

  const frustrated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(contracts)
      .set({ state: transition(contract.state, 'FORCE_MAJEURE'), escrowRemainingCents: 0, refundId: refund.paypalId, forceMajeure: evidence })
      .where(eq(contracts.id, contractId))
      .returning();
    await appendLedger(tx, { kind: 'FORCE_MAJEURE_REFUNDED', contractId, refundId: refund.paypalId, cents: decision.refundCents, evidence }, now);
    return row;
  });
  publish({ type: 'contract', contractId, state: frustrated.state, escrowRemainingCents: 0 });
  return { decision, evidence, contract: frustrated };
}
