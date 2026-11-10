// A payout item's status only moves forward. PayPal can deliver webhooks late or out of order, so
// an old "pending" or "unclaimed" event must never undo "success"; after success, only a return,
// refund or reversal can follow.
const FINAL = new Set(['SUCCESS', 'FAILED', 'RETURNED', 'BLOCKED', 'REFUNDED', 'REVERSED']);
const AFTER_SUCCESS = new Set(['RETURNED', 'REFUNDED', 'REVERSED']);

export function nextItemStatus(current: string, incoming: string): string {
  if (!FINAL.has(current)) return incoming;
  if (current === 'SUCCESS' && AFTER_SUCCESS.has(incoming)) return incoming;
  return current;
}
