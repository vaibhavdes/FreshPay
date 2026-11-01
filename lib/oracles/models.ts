import { google } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import type { LanguageModel } from 'ai';
import { OAuth2Client } from 'google-auth-library';
import type { Env } from '../env';
import { googleTokenSource } from './google-token';

// Hands Vertex the short-lived token from the bridge instead of local Google credentials.
class BridgeTokenClient extends OAuth2Client {
  private readonly token: (scope: string) => Promise<string>;

  constructor(token: (scope: string) => Promise<string>) {
    super();
    this.token = token;
  }

  override async getAccessToken() {
    return { token: await this.token('cloud-platform') };
  }
}

// Gemini through either the Gemini API (API key) or Vertex AI, authorised by a temporary
// token from the bridge (project secret or local grant), otherwise by Google Cloud credentials.
export function geminiModels(env: Env): ((id: string) => LanguageModel) | undefined {
  if (env.AI_PROVIDER === 'vertex') {
    if (!env.GOOGLE_VERTEX_PROJECT) return undefined;
    const bridge = googleTokenSource(env);
    const vertex = createVertex({
      project: env.GOOGLE_VERTEX_PROJECT,
      location: env.GOOGLE_VERTEX_LOCATION,
      ...(bridge && { googleAuthOptions: { authClient: new BridgeTokenClient(bridge.token) } }),
    });
    return (id) => vertex(id);
  }
  return env.GOOGLE_GENERATIVE_AI_API_KEY ? (id) => google(id) : undefined;
}
