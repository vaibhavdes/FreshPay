import type { AgLlmRequest } from 'ag-studio';
import { paypalReadTools } from '@/lib/agents/paypal-tools';
import { runStudioTurn } from '@/lib/agents/studio-turn';
import { env } from '@/lib/env';
import { geminiModels } from '@/lib/oracles/models';
import { allow, withinAiBudget } from '@/lib/rate-limit';

const TURNS_PER_HOUR = 60;
const MAX_BODY_BYTES = 512 * 1024;

// The command centre's Season Agent: AG Studio sends each turn here, Gemini answers on the server.
export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!allow(`agent:${ip}`, TURNS_PER_HOUR, 60 * 60_000) || !withinAiBudget('agent')) {
    return Response.json({ error: { code: 'rate_limited', message: 'The agent is busy. Try again in a few minutes.' } }, { status: 429 });
  }

  const config = env();
  const model = geminiModels(config)?.(config.AGENT_MODEL);
  if (!model) return Response.json({ error: { code: 'no_model', message: 'No AI model is configured for the agent.' } }, { status: 503 });

  try {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return Response.json({ error: { code: 'too_large', message: 'The conversation is too long. Start a new one.' } }, { status: 413 });
    return Response.json(await runStudioTurn(JSON.parse(body) as AgLlmRequest, model, config.AGENT_MODEL, paypalReadTools()));
  } catch (error) {
    console.error('Agent turn failed', error instanceof Error ? error.message : error);
    return Response.json({ error: { code: 'model_error', message: 'The agent could not answer. Try again.' } }, { status: 502 });
  }
}
