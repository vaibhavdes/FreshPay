import { tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { AgLlmRequest } from 'ag-studio';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { inlineRefs, runStudioTurn, toModelMessages } from '@/lib/agents/studio-turn';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

describe('inlineRefs', () => {
  it('inlines $defs references so Gemini accepts the schema', () => {
    const schema = { type: 'object', properties: { filter: { $ref: '#/$defs/Filter' } }, $defs: { Filter: { type: 'object', properties: { field: { type: 'string' } } } } };
    expect(inlineRefs(schema)).toEqual({ type: 'object', properties: { filter: { type: 'object', properties: { field: { type: 'string' } } } } });
  });

  it('stops expanding a recursive schema', () => {
    const schema = { $ref: '#/$defs/Node', $defs: { Node: { type: 'object', properties: { child: { $ref: '#/$defs/Node' } } } } };
    expect(JSON.stringify(inlineRefs(schema))).toContain('"type":"object"');
  });
});

describe('toModelMessages', () => {
  it('turns an AG Studio conversation into model messages with paired tool results', () => {
    expect(
      toModelMessages([
        { id: '1', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text: 'Which plots fail?' }] },
        { id: '2', kind: 'output', type: 'function_call', callId: 'c1', name: 'executeQuery', arguments: '{"fields":["plots.plot"]}' },
        { type: 'function_call_output', callId: 'c1', output: '[{"plot":"Hirebyle"}]', status: 'completed' },
      ]),
    ).toEqual([
      { role: 'user', content: 'Which plots fail?' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'executeQuery', input: { fields: ['plots.plot'] } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'executeQuery', output: { type: 'text', value: '[{"plot":"Hirebyle"}]' } }] },
    ]);
  });
});

describe('runStudioTurn', () => {
  it('hands Studio tool calls back to the browser to run', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'tool-call', toolCallId: 'c9', toolName: 'addPageFilter', input: '{"field":"plots.eudrStatus","value":"FAIL"}' }],
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage,
        warnings: [],
      }),
    });
    const request: AgLlmRequest = {
      input: [{ id: '1', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text: 'Show failing plots' }] }],
      tools: [{ name: 'addPageFilter', description: 'Filter the page', parameters: { type: 'object', properties: { field: { type: 'string' }, value: { type: 'string' } } } }],
      responseFormat: { type: 'text' },
    };

    const response = await runStudioTurn(request, model, 'mock');
    expect(response.status).toBe('completed');
    expect(response.output).toEqual([
      expect.objectContaining({ type: 'function_call', callId: 'c9', name: 'addPageFilter', arguments: '{"field":"plots.eudrStatus","value":"FAIL"}' }),
    ]);
  });

  it('runs PayPal reads on the server within the turn and returns only the answer', async () => {
    let step = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () =>
        step++ === 0
          ? {
              content: [{ type: 'tool-call', toolCallId: 'p1', toolName: 'paypalTransactions', input: '{"days":7,"contains":"ravi"}' }],
              finishReason: { unified: 'tool-calls', raw: undefined },
              usage,
              warnings: [],
            }
          : { content: [{ type: 'text', text: 'PayPal shows $338.00 paid to Ravi this week.' }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] },
    });
    const searched: unknown[] = [];
    const paypalTransactions = tool({
      inputSchema: z.object({ days: z.number(), contains: z.string().optional() }),
      execute: async (input) => {
        searched.push(input);
        return [{ id: 'T1', amount: '338.00 USD', counterparty: 'ravi@example.com' }];
      },
    });
    const request: AgLlmRequest = {
      input: [{ id: '1', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text: 'How much did we pay Ravi?' }] }],
      tools: [],
      responseFormat: { type: 'text' },
    };

    const response = await runStudioTurn(request, model, 'mock', { paypalTransactions });
    expect(searched).toEqual([{ days: 7, contains: 'ravi' }]);
    expect(response.output).toEqual([expect.objectContaining({ type: 'message', content: [expect.objectContaining({ text: 'PayPal shows $338.00 paid to Ravi this week.' })] })]);
  });
});
