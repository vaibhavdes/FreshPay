import { asSchema, jsonSchema, tool, type FlexibleSchema, type JSONSchema7, type Tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import { env } from '../env';
import { paypalRequest } from '../paypal';

// Read-only PayPal tools for the Season Agent. They run on the server inside the agent's turn;
// nothing here can move money. Most come from PayPal's Agent Toolkit; payout batches, which the
// toolkit doesn't cover, are read directly.

const TOOLKIT_READS = {
  transactions: { list: true },
  orders: { get: true },
  disputes: { list: true, get: true },
  shipment: { get: true },
  payments: { getRefunds: true },
  insights: { get: true },
};

type ToolkitInput = Record<string, unknown>;
type ToolkitTool = { description?: string; parameters: FlexibleSchema<ToolkitInput>; execute: (input: ToolkitInput) => Promise<unknown> };

let toolkit: ToolSet | null = null;

// Gemini's schema subset has no `not`; the toolkit uses it for "may be absent", which optional already says.
function forGemini(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(forGemini);
  if (!node || typeof node !== 'object') return node;
  const record = node as Record<string, unknown>;
  if (Array.isArray(record.anyOf)) {
    const options = record.anyOf.filter((o) => !(o && typeof o === 'object' && 'not' in o)).map(forGemini);
    const rest = Object.fromEntries(Object.entries(record).filter(([k]) => k !== 'anyOf').map(([k, v]) => [k, forGemini(v)]));
    return options.length === 1 ? { ...(options[0] as object), ...rest } : { ...rest, anyOf: options };
  }
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== 'not' && k !== '$schema').map(([k, v]) => [k, forGemini(v)]));
}

// The toolkit builds its tools for an older AI SDK; the description, schema and call carry over.
function toolkitTools(): ToolSet {
  if (toolkit) return toolkit;
  const { PAYPAL_CLIENT_ID, PAYPAL_SECRET } = env();
  const kit = new PayPalAgentToolkit({ clientId: PAYPAL_CLIENT_ID, clientSecret: PAYPAL_SECRET, configuration: { actions: TOOLKIT_READS, context: { sandbox: true } } });
  const tools = kit.getTools() as unknown as Record<string, ToolkitTool>;
  toolkit = Object.fromEntries(
    Object.entries(tools).map(([name, t]): [string, Tool] => [
      name,
      {
        description: t.description,
        inputSchema: jsonSchema(async () => forGemini(await asSchema(t.parameters).jsonSchema) as JSONSchema7),
        execute: (input: ToolkitInput) => t.execute(input),
      } as Tool,
    ]),
  );
  return toolkit;
}

type Batch = {
  batch_header: { payout_batch_id: string; batch_status: string; amount?: { value: string; currency: string }; time_completed?: string };
  items?: { transaction_status: string; payout_item: { receiver: string; amount: { value: string; currency: string }; note?: string } }[];
};

export function paypalReadTools(): ToolSet {
  return {
    ...toolkitTools(),
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
  };
}
