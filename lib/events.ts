import { EventEmitter } from 'node:events';
import type { OpStatus } from './db/schema';
import type { ContractState } from './engine/stateMachine';

export type AppEvent =
  | { type: 'paypal.op'; opId: string; op: string; status: OpStatus; paypalId: string | null; learnedFrom: 'SYNC' | 'WEBHOOK' }
  | { type: 'payout.item'; itemId: string; payoutItemId: string | null; status: string }
  | { type: 'milestone'; milestoneId: string; state: string }
  | { type: 'contract'; contractId: string; state: ContractState; escrowRemainingCents: number }
  | { type: 'premium'; contractId: string; state: 'OWED' | 'CHARGED' | 'PAID' }
  | { type: 'dispute'; contractId: string; disputeId: string; status: string }
  | { type: 'subscription'; buyerId: string; status: string };

// Single-instance bus; kept on globalThis so Next.js hot reloads share one emitter.
const holder = globalThis as typeof globalThis & { agritrancheBus?: EventEmitter };
const bus = (holder.agritrancheBus ??= new EventEmitter().setMaxListeners(0));

export function publish(event: AppEvent) {
  bus.emit('event', event);
}

export function subscribe(listener: (event: AppEvent) => void): () => void {
  bus.on('event', listener);
  return () => bus.off('event', listener);
}
