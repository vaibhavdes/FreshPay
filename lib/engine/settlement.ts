import type { EudrStatus } from './gate';
import { allocate, type Allocation } from './splits';

export type QcResult = { deliveredKg: number; acceptedKg: number; qualityPercent: number };

// The balance still owed for compliant coffee: plots that failed the EUDR check cannot be in the lot.
export function balanceDueCents(plots: readonly { valueCents: number; eudrStatus: EudrStatus }[], advanceCents: number): number {
  const compliant = plots.filter((p) => p.eudrStatus === 'PASS').reduce((sum, p) => sum + p.valueCents, 0);
  return Math.max(0, compliant - advanceCents);
}

// At delivery the buyer captures only what QC accepted, scaled by quality; the rest is voided.
export function captureForDelivery(authorizedCents: number, qc: QcResult): { captureCents: number; voidCents: number } {
  const { deliveredKg, acceptedKg, qualityPercent } = qc;
  if (!Number.isSafeInteger(authorizedCents) || authorizedCents < 0) throw new RangeError(`Invalid authorized amount: ${authorizedCents}`);
  if (!Number.isSafeInteger(deliveredKg) || deliveredKg <= 0) throw new RangeError(`Invalid delivered weight: ${deliveredKg}`);
  if (!Number.isSafeInteger(acceptedKg) || acceptedKg < 0 || acceptedKg > deliveredKg) throw new RangeError(`Invalid accepted weight: ${acceptedKg}`);
  if (!Number.isSafeInteger(qualityPercent) || qualityPercent < 0 || qualityPercent > 100) throw new RangeError(`Invalid quality: ${qualityPercent}`);

  const captureCents = Math.floor((authorizedCents * acceptedKg * qualityPercent) / (deliveredKg * 100));
  return { captureCents, voidCents: authorizedCents - captureCents };
}

// The captured balance goes to farmers of compliant plots in proportion to each plot's value.
export function balancePayouts(captureCents: number, plots: readonly { farmerId: string; valueCents: number; eudrStatus: EudrStatus }[]): Allocation[] {
  const weights = new Map<string, number>();
  for (const plot of plots) {
    if (plot.eudrStatus === 'PASS') weights.set(plot.farmerId, (weights.get(plot.farmerId) ?? 0) + plot.valueCents);
  }
  if (weights.size === 0) throw new RangeError('No compliant plot to pay');
  return allocate(captureCents, [...weights].map(([id, weight]) => ({ id, weight })));
}
