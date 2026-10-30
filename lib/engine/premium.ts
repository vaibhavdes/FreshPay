export type Mandate = { perPlotCents: number; capCents: number; accruedCents: number };

export type PremiumDecision = { kind: 'ACCRUE'; cents: number } | { kind: 'SKIP'; reason: 'NO_MANDATE' | 'MANDATE_EXCEEDED' };

// A verified plot earns its farmer the buyer's traceability premium, as long as the buyer's
// mandate has room for the whole amount; premiums are never split to squeeze under the cap.
export function accruePremium(mandate: Mandate | null): PremiumDecision {
  if (!mandate || mandate.perPlotCents <= 0) return { kind: 'SKIP', reason: 'NO_MANDATE' };
  if (mandate.accruedCents + mandate.perPlotCents > mandate.capCents) return { kind: 'SKIP', reason: 'MANDATE_EXCEEDED' };
  return { kind: 'ACCRUE', cents: mandate.perPlotCents };
}
