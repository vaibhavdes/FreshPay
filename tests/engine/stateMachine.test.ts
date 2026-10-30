import { describe, expect, it } from 'vitest';
import { canTransition, InvalidTransition, nextPlotMilestone, transition } from '@/lib/engine/stateMachine';

describe('contract state machine', () => {
  it('runs a season from draft to settled', () => {
    let state = transition('DRAFT', 'FUND');
    state = transition(state, 'ACTIVATE');
    state = transition(state, 'DISPATCH');
    expect(transition(state, 'SETTLE')).toBe('SETTLED');
  });

  it.each(['FUNDED', 'ACTIVE', 'DELIVERING'] as const)('frustrates a %s contract on force majeure', (state) => {
    expect(transition(state, 'FORCE_MAJEURE')).toBe('FRUSTRATED');
  });

  it('refuses transitions that skip steps or leave a final state', () => {
    expect(canTransition('DRAFT', 'DISPATCH')).toBe(false);
    expect(canTransition('ACTIVE', 'DISPATCH')).toBe(true);
    expect(() => transition('DRAFT', 'SETTLE')).toThrow(InvalidTransition);
    expect(() => transition('SETTLED', 'FORCE_MAJEURE')).toThrow('Cannot FORCE_MAJEURE a contract that is SETTLED');
  });
});

describe('plot milestones', () => {
  it('advances in order and ends after harvest', () => {
    expect(nextPlotMilestone([])).toBe('PLOT_VERIFIED');
    expect(nextPlotMilestone(['PLOT_VERIFIED'])).toBe('INPUTS');
    expect(nextPlotMilestone(['PLOT_VERIFIED', 'INPUTS'])).toBe('CROP_CARE');
    expect(nextPlotMilestone(['PLOT_VERIFIED', 'INPUTS', 'CROP_CARE'])).toBe('HARVEST');
    expect(nextPlotMilestone(['PLOT_VERIFIED', 'INPUTS', 'CROP_CARE', 'HARVEST'])).toBeNull();
  });

  it('rejects a history that skipped a milestone', () => {
    expect(() => nextPlotMilestone(['INPUTS'])).toThrow(RangeError);
  });
});
