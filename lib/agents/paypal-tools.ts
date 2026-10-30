import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { paypalRequest, searchTransactions } from '../paypal';

// Read-only PayPal tools for the Season Agent. They run on the server inside the agent's turn;
// nothing here can move money.

const DAY = 24 * 60 * 60_000;

type Batch = {
  batch_header: { payout_batch_id: string; batch_status: string; amount?: { value: string; currency: string }; time_completed?: string };
  items?: { transaction_status: string; payout_item: { receiver: string; amount: { value: string; currency: string }; note?: string } }[];
};

type Dispute = { dispute_id: string; reason?: string; status?: string; dispute_amount?: { value: string; currency_code: string }; create_time?: string };

export function paypalReadTools(): ToolSet {
  return {
    paypalTransactions: tool({
      description:
        'Search this merchant account in PayPal Transaction Search: payments in and out over the last N days (at most 31). ' +
        'Use it to answer what PayPal actually recorded, e.g. how much was paid to a farmer or received from the buyer. Amounts are as PayPal reports them.',
      inputSchema: z.object({
        days: z.number().int().min(1).max(31).describe('How many days back to search'),
        contains: z.string().optional().describe('Only transactions whose email, subject or note contains this text'),
      }),
      execute: async ({ days, contains }) => {
        const end = new Date();
        const rows = await searchTransactions(new Date(end.getTime() - days * DAY), end);
        const needle = contains?.toLowerCase();
        return rows
          .map(({ transaction_info: t, payer_info: p }) => ({
            id: t.transaction_id,
            date: t.transaction_initiation_date,
            amount: t.transaction_amount ? `${t.transaction_amount.value} ${t.transaction_amount.currency_code}` : null,
            status: t.transaction_status,
            eventCode: t.transaction_event_code,
            counterparty: p?.email_address ?? null,
            note: t.transaction_note ?? t.transaction_subject ?? null,
          }))
          .filter((r) => !needle || [r.counterparty, r.note].some((v) => v?.toLowerCase().includes(needle)))
          .slice(0, 50);
      },
    }),
    paypalPayoutBatch: tool({
      description: 'Look up one PayPal Payouts batch by its batch id: overall status and each item with receiver, amount and status (SUCCESS, UNCLAIMED, FAILED and so on).',
      inputSchema: z.object({ batchId: z.string().min(1) }),
      execute: async ({ batchId }) => {
        const batch = await paypalRequest<Batch>(`/v1/payments/payouts/${encodeURIComponent(batchId)}`);
        return {
          status: batch.batch_header.batch_status,
          total: batch.batch_header.amount ? `${batch.batch_header.amount.value} ${batch.batch_header.amount.currency}` : null,
          completed: batch.batch_header.time_completed ?? null,
          items: (batch.items ?? []).map((i) => ({ receiver: i.payout_item.receiver, amount: `${i.payout_item.amount.value} ${i.payout_item.amount.currency}`, status: i.transaction_status })),
        };
      },
    }),
    paypalDisputes: tool({
      description: 'List open and recent PayPal disputes on this merchant account, with reason, status and amount.',
      inputSchema: z.object({}),
      execute: async () => {
        const { items = [] } = await paypalRequest<{ items?: Dispute[] }>('/v1/customer/disputes?page_size=20');
        return items.map((d) => ({
          id: d.dispute_id,
          reason: d.reason ?? null,
          status: d.status ?? null,
          amount: d.dispute_amount ? `${d.dispute_amount.value} ${d.dispute_amount.currency_code}` : null,
          opened: d.create_time ?? null,
        }));
      },
    }),
  };
}
