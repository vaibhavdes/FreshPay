import { describe, expect, it } from 'vitest';
import { evaluateForceMajeure, type PlotWeather } from '@/lib/engine/force-majeure';

const plots = (events: PlotWeather['event'][]): PlotWeather[] => events.map((event, i) => ({ plotId: `plot-${i}`, valueCents: [600_000, 900_000, 300_000][i], event }));

describe('evaluateForceMajeure', () => {
  it('refunds the unearned advance when verified weather hit most of the value', () => {
    expect(evaluateForceMajeure({ state: 'ACTIVE', escrowRemainingCents: 512_300, plots: plots(['HAIL', 'HAIL', 'NONE']) })).toEqual({
      kind: 'REFUND',
      refundCents: 512_300,
      affectedPlotIds: ['plot-0', 'plot-1'],
    });
  });

  it('needs a weather event, on enough of the value', () => {
    expect(evaluateForceMajeure({ state: 'ACTIVE', escrowRemainingCents: 1, plots: plots(['NONE', 'NONE', 'NONE']) })).toEqual({ kind: 'REJECT', reasons: ['NO_WEATHER_EVENT'] });
    expect(evaluateForceMajeure({ state: 'FUNDED', escrowRemainingCents: 1, plots: plots(['NONE', 'NONE', 'FLOOD']) })).toEqual({ kind: 'REJECT', reasons: ['TOO_FEW_PLOTS_AFFECTED'] });
  });

  it('refuses a finished season or one with nothing left to refund', () => {
    expect(evaluateForceMajeure({ state: 'SETTLED', escrowRemainingCents: 0, plots: plots(['DROUGHT', 'DROUGHT', 'DROUGHT']) })).toEqual({
      kind: 'REJECT',
      reasons: ['CONTRACT_NOT_RUNNING', 'NOTHING_TO_REFUND'],
    });
    expect(evaluateForceMajeure({ state: 'DELIVERING', escrowRemainingCents: 10, plots: plots(['FLOOD', 'FLOOD', 'FLOOD']) }).kind).toBe('REFUND');
  });
});
