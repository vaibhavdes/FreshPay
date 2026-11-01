import { generateText } from 'ai';
import { env } from '@/lib/env';
import { geminiModels } from '@/lib/oracles/models';
import { GoogleGrantError, googleTokenSource } from '@/lib/oracles/google-token';
import { allow } from '@/lib/rate-limit';

// Whether this server can reach Gemini right now: the token bridge (when a grant is configured)
// and one tiny model call. Rate limited, and it never returns the token.
export async function GET() {
  if (!allow('health:ai', 10, 60 * 60_000)) return Response.json({ error: 'Checked too often; try again within the hour' }, { status: 429 });
  const config = env();
  const report: Record<string, unknown> = { mode: config.AI_MODE, provider: config.AI_PROVIDER, model: config.AI_MODELS[0], access: googleTokenSource(config)?.kind ?? 'none' };

  const bridge = googleTokenSource(config);
  if (config.AI_PROVIDER === 'vertex' && bridge) {
    try {
      await bridge.token('cloud-platform');
      report.bridge = 'ok';
    } catch (error) {
      report.bridge = error instanceof GoogleGrantError ? error.code : error instanceof Error ? error.message.slice(0, 120) : 'failed';
      return Response.json(report, { status: 503 });
    }
  }

  const model = geminiModels(config)?.(config.AI_MODELS[0]);
  if (!model) return Response.json({ ...report, gemini: 'not configured' }, { status: 503 });
  try {
    const { text } = await generateText({ model, prompt: 'Reply with the single word OK.', abortSignal: AbortSignal.timeout(15_000), maxRetries: 0 });
    return Response.json({ ...report, gemini: text.trim().slice(0, 20) });
  } catch (error) {
    return Response.json({ ...report, gemini: error instanceof Error ? error.message.slice(0, 160) : 'failed' }, { status: 503 });
  }
}
