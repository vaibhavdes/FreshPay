export type ContractState = 'DRAFT' | 'FUNDED' | 'ACTIVE' | 'DELIVERING' | 'SETTLED' | 'FRUSTRATED';
export type ContractEvent = 'FUND' | 'ACTIVATE' | 'DISPATCH' | 'SETTLE' | 'FORCE_MAJEURE';

const TRANSITIONS: Record<ContractState, Partial<Record<ContractEvent, ContractState>>> = {
  DRAFT: { FUND: 'FUNDED' },
  FUNDED: { ACTIVATE: 'ACTIVE', FORCE_MAJEURE: 'FRUSTRATED' },
  ACTIVE: { DISPATCH: 'DELIVERING', FORCE_MAJEURE: 'FRUSTRATED' },
  DELIVERING: { SETTLE: 'SETTLED', FORCE_MAJEURE: 'FRUSTRATED' },
  SETTLED: {},
  FRUSTRATED: {},
};

export class InvalidTransition extends Error {
  readonly state: ContractState;
  readonly event: ContractEvent;

  constructor(state: ContractState, event: ContractEvent) {
    super(`Cannot ${event} a contract that is ${state}`);
    this.name = 'InvalidTransition';
    this.state = state;
    this.event = event;
  }
}

export function canTransition(state: ContractState, event: ContractEvent): boolean {
  return TRANSITIONS[state][event] !== undefined;
}

export function transition(state: ContractState, event: ContractEvent): ContractState {
  const next = TRANSITIONS[state][event];
  if (!next) throw new InvalidTransition(state, event);
  return next;
}

export const PLOT_MILESTONES = ['PLOT_VERIFIED', 'INPUTS', 'CROP_CARE', 'HARVEST'] as const;
export type PlotMilestone = (typeof PLOT_MILESTONES)[number];

// Plot milestones are paid strictly in order; null once the plot has finished them all.
export function nextPlotMilestone(completed: readonly PlotMilestone[]): PlotMilestone | null {
  completed.forEach((milestone, i) => {
    if (milestone !== PLOT_MILESTONES[i]) throw new RangeError(`Milestones out of order: ${completed.join(', ')}`);
  });
  return PLOT_MILESTONES[completed.length] ?? null;
}
