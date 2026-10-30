import { randomUUID } from 'node:crypto';
import { generateText, isStepCount, jsonSchema, Output, tool, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import type { AgAiConversationItem, AgAiOutputItem, AgLlmRequest, AgLlmResponse } from 'ag-studio';

// One AG Studio agent turn run on Gemini. Studio's own tools (filters, widgets, queries) are only
// declared here: Gemini chooses them and Studio runs them in the browser. Tools passed in
// `serverTools` (PayPal reads) run here, inside the same turn.

type JsonSchema = { [key: string]: unknown };

// Gemini accepts a subset of JSON Schema without $ref, so references are inlined (cycles stop at a depth).
export function inlineRefs(schema: JsonSchema, defs: Record<string, JsonSchema> = {}, depth = 0): JsonSchema {
  const local = { ...defs, ...((schema.$defs ?? schema.definitions ?? {}) as Record<string, JsonSchema>) };
  const walk = (node: unknown, level: number): unknown => {
    if (Array.isArray(node)) return node.map((n) => walk(n, level));
    if (!node || typeof node !== 'object') return node;
    const record = node as JsonSchema;
    if (typeof record.$ref === 'string') {
      const target = local[record.$ref.split('/').pop()!];
      return target && level < 6 ? walk(target, level + 1) : { type: 'object' };
    }
    return Object.fromEntries(Object.entries(record).filter(([k]) => k !== '$defs' && k !== 'definitions' && k !== '$schema').map(([k, v]) => [k, walk(v, level)]));
  };
  return walk(schema, depth) as JsonSchema;
}

const textOf = (content: { type: string; text?: string }[]) => content.flatMap((c) => (c.type === 'text' && c.text ? [c.text] : [])).join('\n');

export function toModelMessages(items: AgAiConversationItem[]): ModelMessage[] {
  const messages: ModelMessage[] = [];
  const toolNames = new Map<string, string>();
  const last = () => messages.at(-1);

  for (const item of items) {
    if (item.type === 'message' && item.kind === 'input') {
      messages.push({ role: item.role, content: textOf(item.content) } as ModelMessage);
    } else if (item.type === 'message') {
      messages.push({ role: 'assistant', content: [{ type: 'text', text: textOf(item.content as { type: string; text?: string }[]) }] });
    } else if (item.type === 'function_call') {
      toolNames.set(item.callId, item.name);
      const part = { type: 'tool-call' as const, toolCallId: item.callId, toolName: item.name, input: JSON.parse(item.arguments || '{}') };
      const previous = last();
      if (previous?.role === 'assistant' && Array.isArray(previous.content)) previous.content.push(part);
      else messages.push({ role: 'assistant', content: [part] });
    } else if (item.type === 'function_call_output') {
      const part = { type: 'tool-result' as const, toolCallId: item.callId, toolName: toolNames.get(item.callId) ?? 'tool', output: { type: 'text' as const, value: item.output } };
      const previous = last();
      if (previous?.role === 'tool') previous.content.push(part);
      else messages.push({ role: 'tool', content: [part] });
    }
  }
  return messages;
}

export async function runStudioTurn(request: AgLlmRequest, model: LanguageModel, modelId: string, serverTools: ToolSet = {}): Promise<AgLlmResponse> {
  const studioTools = Object.fromEntries(
    (request.tools ?? []).map((t) => [t.name, tool({ description: t.description, inputSchema: jsonSchema(inlineRefs(t.parameters as JsonSchema) as never) })]),
  );
  const choice = request.toolChoice;
  const json = request.responseFormat.type === 'json' ? request.responseFormat : null;

  const result = await generateText({
    model,
    system: request.instructions,
    messages: toModelMessages(request.input),
    tools: { ...serverTools, ...studioTools },
    toolChoice: typeof choice === 'object' ? { type: 'tool', toolName: choice.name } : choice,
    ...(json && { output: Output.object({ schema: jsonSchema(inlineRefs(json.schema as JsonSchema) as never) }) }),
    // PayPal reads may take a few steps; a Studio tool call ends the turn so the browser can run it.
    stopWhen: isStepCount(4),
    abortSignal: AbortSignal.timeout(60_000),
  });

  const output: AgAiOutputItem[] = [];
  const text = json ? JSON.stringify(result.output) : result.text;
  if (text) output.push({ id: randomUUID(), kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text, annotations: [] }] });
  for (const call of result.toolCalls) {
    if (!(call.toolName in studioTools)) continue;
    output.push({ id: randomUUID(), kind: 'output', type: 'function_call', callId: call.toolCallId, name: call.toolName, arguments: JSON.stringify(call.input ?? {}), status: 'completed' });
  }
  return { id: randomUUID(), createdAt: Date.now(), status: 'completed', output, model: modelId };
}
