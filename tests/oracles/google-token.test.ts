import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:https', () => ({ request: vi.fn() }));

const { request } = await import('node:https');

type Call = { url: URL; options: { method: string; family: number; headers: Record<string, string> } };

function grantFile(overrides: Record<string, unknown> = {}) {
  const path = join(tmpdir(), `grant-${Math.random().toString(36).slice(2)}.json`);
  const grant = {
    bridge_url: 'https://bridge.example.run.app',
    temporary_secret: 'test-secret',
    scopes: ['earthengine', 'cloud-platform'],
    expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
    ...overrides,
  };
  writeFileSync(path, JSON.stringify(grant));
  return path;
}

function bridgeAnswers(status: number, body: object) {
  const calls: Call[] = [];
  vi.mocked(request).mockImplementation(((url: URL, options: Call['options'], callback: (res: PassThrough) => void) => {
    calls.push({ url, options });
    const res = Object.assign(new PassThrough(), { statusCode: status });
    setTimeout(() => {
      callback(res);
      res.end(JSON.stringify(body));
    });
    return Object.assign(new EventEmitter(), { end: () => {}, destroy: () => {} });
  }) as never);
  return calls;
}

async function freshClient() {
  vi.resetModules();
  return import('@/lib/oracles/google-token');
}

beforeEach(() => {
  vi.mocked(request).mockReset();
});

describe('temporaryGoogleToken', () => {
  it('signs the request with HMAC-SHA256 of timestamp.scope over IPv4', async () => {
    const calls = bridgeAnswers(200, { access_token: 'ya29.test', expires_in: 900 });
    const { temporaryGoogleToken } = await freshClient();

    expect(await temporaryGoogleToken(grantFile(), 'cloud-platform')).toBe('ya29.test');

    const [{ url, options }] = calls;
    expect(url.toString()).toBe('https://bridge.example.run.app/temporary-token?scope=cloud-platform');
    expect(options).toMatchObject({ method: 'POST', family: 4 });
    const timestamp = options.headers['x-indra-timestamp'];
    expect(timestamp).toMatch(/^\d{13}$/);
    expect(options.headers['x-indra-signature']).toBe(createHmac('sha256', 'test-secret').update(`${timestamp}.cloud-platform`).digest('hex'));
  });

  it('reuses the cached token and shares one refresh between concurrent callers', async () => {
    const calls = bridgeAnswers(200, { access_token: 'ya29.shared', expires_in: 900 });
    const { temporaryGoogleToken } = await freshClient();
    const path = grantFile();

    const tokens = await Promise.all([temporaryGoogleToken(path, 'cloud-platform'), temporaryGoogleToken(path, 'cloud-platform')]);
    expect(await temporaryGoogleToken(path, 'cloud-platform')).toBe('ya29.shared');
    expect(tokens).toEqual(['ya29.shared', 'ya29.shared']);
    expect(calls).toHaveLength(1);
  });

  it('refuses an expired grant without calling the bridge', async () => {
    const calls = bridgeAnswers(200, { access_token: 'never', expires_in: 900 });
    const { temporaryGoogleToken } = await freshClient();

    await expect(temporaryGoogleToken(grantFile({ expires_at: new Date(Date.now() - 1000).toISOString() }), 'cloud-platform')).rejects.toMatchObject({
      code: 'TEMPORARY_ACCESS_DISABLED_OR_EXPIRED',
    });
    expect(calls).toHaveLength(0);
  });

  it('refuses a scope the grant does not include', async () => {
    const { temporaryGoogleToken } = await freshClient();
    await expect(temporaryGoogleToken(grantFile({ scopes: ['earthengine'] }), 'cloud-platform')).rejects.toMatchObject({ code: 'SCOPE_NOT_ALLOWED' });
  });

  it('reports the bridge error code', async () => {
    bridgeAnswers(403, { error: 'IP_NOT_ALLOWED' });
    const { temporaryGoogleToken } = await freshClient();
    await expect(temporaryGoogleToken(grantFile(), 'cloud-platform')).rejects.toMatchObject({ code: 'IP_NOT_ALLOWED' });
  });
});
