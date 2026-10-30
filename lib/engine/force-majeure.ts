import type { ContractState } from './stateMachine';
import type { WeatherEvent } from './weather';

export type PlotWeather = { plotId: string; valueCents: number; event: WeatherEvent };

export type ForceMajeureDecision =
  | { kind: 'REFUND'; refundCents: number; affectedPlotIds: string[] }
  | { kind: 'REJECT'; reasons: ('CONTRACT_NOT_RUNNING' | 'NO_WEATHER_EVENT' | 'TOO_FEW_PLOTS_AFFECTED' | 'NOTHING_TO_REFUND')[] };

// The season ends only when verified weather hit plots carrying at least this share of the value.
export const MIN_AFFECTED_SHARE_PERCENT = 50;

export function evaluateForceMajeure(input: { state: ContractState; escrowRemainingCents: number; plots: readonly PlotWeather[] }): ForceMajeureDecision {
  const reasons: Extract<ForceMajeureDecision, { kind: 'REJECT' }>['reasons'] = [];
  if (input.state !== 'FUNDED' && input.state !== 'ACTIVE' && input.state !== 'DELIVERING') reasons.push('CONTRACT_NOT_RUNNING');

  const affected = input.plots.filter((p) => p.event !== 'NONE');
  const totalValue = input.plots.reduce((sum, p) => sum + p.valueCents, 0);
  const affectedValue = affected.reduce((sum, p) => sum + p.valueCents, 0);
  if (affected.length === 0) reasons.push('NO_WEATHER_EVENT');
  else if (affectedValue * 100 < totalValue * MIN_AFFECTED_SHARE_PERCENT) reasons.push('TOO_FEW_PLOTS_AFFECTED');

  if (input.escrowRemainingCents <= 0) reasons.push('NOTHING_TO_REFUND');

  if (reasons.length) return { kind: 'REJECT', reasons };
  return { kind: 'REFUND', refundCents: input.escrowRemainingCents, affectedPlotIds: affected.map((p) => p.plotId) };
}
