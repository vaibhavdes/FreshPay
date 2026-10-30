import type { AgAiEvent, AgLlmAdapter, AgLlmResponse } from 'ag-studio';

// AG Studio's model connection: each turn goes to our server, which calls Gemini, so no key or
// grant ever reaches the browser. The finished turn is replayed to Studio as AG-UI events.
export function geminiAdapter(endpoint = '/api/ai/agent'): AgLlmAdapter {
  return {
    executeTurn(request, options) {
      const complete: Promise<AgLlmResponse> = fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: options?.signal,
      }).then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as AgLlmResponse & { error?: { code: string; message: string } };
        if (res.ok) return body;
        return { id: crypto.randomUUID(), createdAt: Date.now(), status: 'failed', output: [], error: body.error ?? { code: `http_${res.status}`, message: 'The agent could not answer.' } };
      });

      async function* events(): AsyncGenerator<AgAiEvent> {
        const response = await complete;
        for (const item of response.output) {
          if (item.type === 'message') {
            yield { type: 'TEXT_MESSAGE_START', messageId: item.id, role: 'assistant' };
            for (const part of item.content) if (part.type === 'text') yield { type: 'TEXT_MESSAGE_CONTENT', messageId: item.id, delta: part.text };
            yield { type: 'TEXT_MESSAGE_END', messageId: item.id };
          } else if (item.type === 'function_call') {
            yield { type: 'TOOL_CALL_START', toolCallId: item.callId, toolCallName: item.name };
            yield { type: 'TOOL_CALL_ARGS', toolCallId: item.callId, delta: item.arguments };
            yield { type: 'TOOL_CALL_END', toolCallId: item.callId };
          }
        }
      }

      return { stream: { [Symbol.asyncIterator]: () => events() }, complete };
    },
  };
}
