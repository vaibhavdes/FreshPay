import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request } from 'node:https';

// Short-lived Google access tokens from a token bridge: the hosted server signs /project-token
// requests with its project secret; a local machine signs /temporary-token requests with an
// expiring grant file. Tokens stay in server memory only and are never logged, stored or sent to
// a browser.

type Grant = { bridge_url: string; temporary_secret: string; scopes: string[]; expires_at: string };
type CachedToken = { token: string; usableUntil: number };

const REFRESH_MARGIN_MS = 60_000;
const TIMEOUT_MS = 10_000;

export class GoogleGrantError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GoogleGrantError';
    this.code = code;
  }
}

async function readGrant(path: string, scope: string): Promise<Grant> {
  const grant = JSON.parse(await readFile(path, 'utf8')) as Partial<Grant>;
  if (!grant.bridge_url?.startsWith('https://') || !grant.temporary_secret || !grant.expires_at || !Array.isArray(grant.scopes)) {
    throw new GoogleGrantError('MALFORMED_GRANT', 'The Google access grant file is incomplete');
  }
  if (Date.parse(grant.expires_at) <= Date.now()) {
    throw new GoogleGrantError('TEMPORARY_ACCESS_DISABLED_OR_EXPIRED', `Google access expired at ${grant.expires_at}; ask for a new grant`);
  }
  if (!grant.scopes.includes(scope)) throw new GoogleGrantError('SCOPE_NOT_ALLOWED', `The grant does not include ${scope}`);
  return grant as Grant;
}

type Signed = { url: URL; signed: (timestamp: string) => string };

const grantRequest = (grant: Grant, scope: string): Signed => ({
  url: new URL(`/temporary-token?scope=${encodeURIComponent(scope)}`, grant.bridge_url),
  signed: (timestamp) => createHmac('sha256', grant.temporary_secret).update(`${timestamp}.${scope}`).digest('hex'),
});

// Project signatures use their own prefix, so they never pass for any other bridge route.
const projectRequest = (bridgeUrl: string, secret: string, scope: string): Signed => ({
  url: new URL(`/project-token?scope=${encodeURIComponent(scope)}`, bridgeUrl),
  signed: (timestamp) => createHmac('sha256', secret).update(`project.${timestamp}.${scope}`).digest('hex'),
});

function issueToken({ url, signed }: Signed): Promise<{ access_token: string; expires_in: number }> {
  const timestamp = String(Date.now());
  return new Promise((resolve, reject) => {
    // IPv4 only: the bridge allows IPv4 addresses, not a machine's IPv6 one.
    const req = request(url, { method: 'POST', family: 4, timeout: TIMEOUT_MS, headers: { 'x-indra-timestamp': timestamp, 'x-indra-signature': signed(timestamp) } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        const parsed = (() => {
          try {
            return JSON.parse(body) as Record<string, unknown>;
          } catch {
            return {};
          }
        })();
        if (res.statusCode === 200 && typeof parsed.access_token === 'string' && typeof parsed.expires_in === 'number') {
          resolve({ access_token: parsed.access_token, expires_in: parsed.expires_in });
          return;
        }
        const code = typeof parsed.error === 'string' ? parsed.error : typeof parsed.code === 'string' ? parsed.code : `HTTP_${res.statusCode}`;
        reject(new GoogleGrantError(code, `The token bridge refused the request (${code})`));
      });
    });
    req.on('timeout', () => req.destroy(new GoogleGrantError('BRIDGE_TIMEOUT', 'The token bridge did not answer in time')));
    req.on('error', reject);
    req.end();
  });
}

const cache = new Map<string, CachedToken>();
const inFlight = new Map<string, Promise<string>>();

export const temporaryGoogleToken = (grantPath: string, scope: string) =>
  cachedToken(scope, async () => issueToken(grantRequest(await readGrant(grantPath, scope), scope)));

export const projectGoogleToken = (bridgeUrl: string, secret: string, scope: string) => cachedToken(scope, () => issueToken(projectRequest(bridgeUrl, secret, scope)));

// The configured way to reach the bridge: the project secret where set (the hosted demo), else a
// local grant file.
type BridgeSettings = { GOOGLE_TOKEN_BRIDGE_URL?: string; GOOGLE_TOKEN_BRIDGE_SECRET?: string; GOOGLE_TOKEN_GRANT_FILE?: string };
export function googleTokenSource({ GOOGLE_TOKEN_BRIDGE_URL: url, GOOGLE_TOKEN_BRIDGE_SECRET: secret, GOOGLE_TOKEN_GRANT_FILE: grant }: BridgeSettings) {
  if (url && secret) return { kind: 'project', token: (scope: string) => projectGoogleToken(url, secret, scope) } as const;
  if (grant) return { kind: 'grant', token: (scope: string) => temporaryGoogleToken(grant, scope) } as const;
  return null;
}

function cachedToken(scope: string, fetchToken: () => Promise<{ access_token: string; expires_in: number }>): Promise<string> {
  const cached = cache.get(scope);
  if (cached && Date.now() < cached.usableUntil - REFRESH_MARGIN_MS) return Promise.resolve(cached.token);

  // Concurrent callers share one refresh; the grant is re-read so a replacement is picked up.
  let pending = inFlight.get(scope);
  if (!pending) {
    pending = fetchToken()
      .then(({ access_token, expires_in }) => {
        cache.set(scope, { token: access_token, usableUntil: Date.now() + expires_in * 1000 });
        return access_token;
      })
      .finally(() => inFlight.delete(scope));
    inFlight.set(scope, pending);
  }
  return pending;
}
