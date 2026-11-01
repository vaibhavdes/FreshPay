import { generateText } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/lib/env';
import { geminiModels } from '@/lib/oracles/models';

vi.mock('@/lib/oracles/google-token', () => ({ googleTokenSource: vi.fn((env: { GOOGLE_TOKEN_GRANT_FILE?: string }) => (env.GOOGLE_TOKEN_GRANT_FILE ? { kind: 'grant', token: async () => 'grant-token' } : null)) }));

const vertexEnv = {
  AI_PROVIDER: 'vertex',
  GOOGLE_VERTEX_PROJECT: 'agritranche-sandbox',
  GOOGLE_VERTEX_LOCATION: 'global',
  GOOGLE_TOKEN_GRANT_FILE: '/tmp/grant.json',
} as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('geminiModels', () => {
  it('calls Vertex in the configured project with the token from the grant', async () => {
    const seen: { url: string; authorization: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init: RequestInit = {}) => {
        seen.push({ url: String(input), authorization: new Headers(init.headers).get('authorization') });
        return Response.json({
          candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        });
      }),
    );

    const modelFor = geminiModels(vertexEnv)!;
    const { text } = await generateText({ model: modelFor('gemini-3.5-flash-lite'), prompt: 'ping' });

    expect(text).toBe('ok');
    expect(seen[0].url).toContain('/projects/agritranche-sandbox/locations/global/publishers/google/models/gemini-3.5-flash-lite');
    expect(seen[0].authorization).toBe('Bearer grant-token');
  });

  it('has no model without credentials', () => {
    expect(geminiModels({ ...vertexEnv, GOOGLE_VERTEX_PROJECT: undefined })).toBeUndefined();
    expect(geminiModels({ AI_PROVIDER: 'google' } as Env)).toBeUndefined();
  });
});
