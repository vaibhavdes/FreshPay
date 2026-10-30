import { google } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import type { LanguageModel } from 'ai';
import { OAuth2Client } from 'google-auth-library';
import type { Env } from '../env';
import { temporaryGoogleToken } from './google-token';

// Hands Vertex the short-lived token from the grant instead of local Google credentials.
class GrantTokenClient extends OAuth2Client {
  private readonly grantPath: string;

  constructor(grantPath: string) {
    super();
    this.grantPath = grantPath;
  }

  override async getAccessToken() {
    return { token: await temporaryGoogleToken(this.grantPath, 'cloud-platform') };
  }
}

// Gemini through either the Gemini API (API key) or Vertex AI, authorised by a temporary
// token grant when GOOGLE_TOKEN_GRANT_FILE is set, otherwise by Google Cloud credentials.
export function geminiModels(env: Env): ((id: string) => LanguageModel) | undefined {
  if (env.AI_PROVIDER === 'vertex') {
    if (!env.GOOGLE_VERTEX_PROJECT) return undefined;
    const vertex = createVertex({
      project: env.GOOGLE_VERTEX_PROJECT,
      location: env.GOOGLE_VERTEX_LOCATION,
      ...(env.GOOGLE_TOKEN_GRANT_FILE && { googleAuthOptions: { authClient: new GrantTokenClient(env.GOOGLE_TOKEN_GRANT_FILE) } }),
    });
    return (id) => vertex(id);
  }
  return env.GOOGLE_GENERATIVE_AI_API_KEY ? (id) => google(id) : undefined;
}
