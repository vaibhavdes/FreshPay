import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicOrigin, redirectTo } from '@/lib/http';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('publicOrigin', () => {
  const behindProxy = new Request('https://localhost:10000/api/x', { headers: { 'x-forwarded-host': 'farmproof.example', 'x-forwarded-proto': 'https' } });

  it('uses the forwarded host, not the internal one', () => {
    vi.stubEnv('APP_URL', '');
    expect(publicOrigin(behindProxy)).toBe('https://farmproof.example');
    expect(publicOrigin(new Request('http://localhost:3000/api/x'))).toBe('http://localhost:3000');
  });

  it('prefers the configured public address', () => {
    vi.stubEnv('APP_URL', 'https://farmproof-2y11.onrender.com/');
    expect(publicOrigin(behindProxy)).toBe('https://farmproof-2y11.onrender.com');
  });
});

describe('redirectTo', () => {
  it('keeps redirects inside the app and relative', () => {
    expect(redirectTo('/tour', 303).headers.get('Location')).toBe('/tour');
    expect(redirectTo('//evil.example', 302).headers.get('Location')).toBe('/');
    expect(redirectTo('/tour', 303, { 'Set-Cookie': 'a=b' }).headers.get('Set-Cookie')).toBe('a=b');
  });
});
