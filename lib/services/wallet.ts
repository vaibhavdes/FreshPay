import { and, eq, inArray, like } from 'drizzle-orm';
import { MILESTONE_LABELS } from '../claim-copy';
import type { Db } from '../db/client';
import { contracts, farmers, inputDealers, milestones, payoutItems, paypalOps } from '../db/schema';
import type { PlotMilestone } from '../engine/stateMachine';
import { paypalRequest } from '../paypal';
import { valueToCents } from '../paypal-sdk';

// `bonus` marks a good-practice bonus, paid by the buyer on top of the season fund.
export type WalletPayment = { id: string; name: string; role: 'Farmer' | 'Supplier'; stage: string; cents: number; status: string; at: number; bonus: boolean };

export type SeasonWallet = {
  fundCents: number;
  leftCents: number;
  toSuppliersCents: number;
  toFarmersCents: number;
  bonusCents: number;
  heldCents: number;
  // The largest stage payment still to come, to compare with what PayPal holds.
  nextPaymentCents: number;
  payments: WalletPayment[];
};

const SETTLED = new Set(['FAILED', 'RETURNED']);

export async function seasonWallet(db: Db, contractId: string): Promise<SeasonWallet | null> {
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  if (!contract) return null;
  const stages = await db.select().from(milestones).where(eq(milestones.contractId, contractId));
  const ops = await db.select().from(paypalOps).where(and(eq(paypalOps.op, 'payouts.batch'), like(paypalOps.key, `${contractId}/%`)));
  const items = ops.length ? await db.select().from(payoutItems).where(inArray(payoutItems.opId, ops.map((o) => o.id))) : [];
  const people = new Map((await db.select({ id: farmers.id, name: farmers.name }).from(farmers)).map((f) => [f.id, f.name]));
  const suppliers = new Map((await db.select({ id: inputDealers.id, name: inputDealers.name }).from(inputDealers)).map((s) => [s.id, s.name]));

  const payments = items
    .map((i): WalletPayment => {
      const op = ops.find((o) => o.id === i.opId)!;
      const bonus = op.key.split('/')[1] === 'premium';
      const type = op.key.split('/')[2] as PlotMilestone;
      const stage = stages.find((m) => m.plotId === op.key.split('/')[1] && m.type === type);
      return {
        id: i.id,
        name: people.get(i.payeeId) ?? suppliers.get(i.payeeId) ?? i.payeeId,
        role: people.has(i.payeeId) ? 'Farmer' : 'Supplier',
        stage: bonus ? 'Good-practice bonus' : (stage?.label ?? MILESTONE_LABELS[type]?.title ?? 'Payment'),
        cents: i.cents,
        status: i.status,
        at: i.updatedAt,
        bonus,
      };
    })
    .sort((a, b) => b.at - a.at);
  const sent = payments.filter((p) => !SETTLED.has(p.status) && !p.bonus);

  return {
    fundCents: contract.advanceCents,
    leftCents: contract.escrowRemainingCents,
    toSuppliersCents: sent.filter((p) => p.role === 'Supplier').reduce((sum, p) => sum + p.cents, 0),
    toFarmersCents: sent.filter((p) => p.role === 'Farmer').reduce((sum, p) => sum + p.cents, 0),
    bonusCents: payments.filter((p) => p.bonus && !SETTLED.has(p.status)).reduce((sum, p) => sum + p.cents, 0),
    heldCents: stages.filter((m) => m.state === 'REVIEW').reduce((sum, m) => sum + m.trancheCents, 0),
    nextPaymentCents: Math.max(0, ...stages.filter((m) => m.state !== 'RELEASED').map((m) => m.trancheCents)),
    payments,
  };
}

type Balances = { balances?: { currency: string; available_balance?: { value: string } }[]; as_of_time?: string };

let cached: { at: number; value: { availableCents: number; asOf: string | null } | null } | null = null;

// What the PayPal account that sends every payout actually holds, read at most once a minute.
export async function paypalBalance(now = Date.now()) {
  if (cached && now - cached.at < 60_000) return cached.value;
  try {
    const body = await paypalRequest<Balances>('/v1/reporting/balances?currency_code=USD');
    const usd = body.balances?.find((b) => b.currency === 'USD')?.available_balance;
    cached = { at: now, value: usd ? { availableCents: valueToCents(usd.value), asOf: body.as_of_time ?? null } : null };
  } catch {
    cached = { at: now, value: null };
  }
  return cached.value;
}
