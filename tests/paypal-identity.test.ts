import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizeUrl, identityCookie, identityFromCode, readIdentity, readState } from '@/lib/paypal-identity';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Log in with PayPal', () => {
  it('sends the farmer to PayPal with the attributes needed for payouts and a signed return path', () => {
    const url = new URL(authorizeUrl('https://farm.test', '/opportunities/opp-1'));
    expect(url.origin + url.pathname).toBe('https://www.sandbox.paypal.com/connect/');
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('redirect_uri')).toBe('https://farm.test/api/auth/paypal/callback');
    expect(readState(url.searchParams.get('state'))).toMatchObject({ next: '/opportunities/opp-1' });

    const offsite = new URL(authorizeUrl('https://farm.test', '//evil.test'));
    expect(readState(offsite.searchParams.get('state'))).toMatchObject({ next: '/opportunities' });
    expect(readState('forged.state')).toBeNull();
  });

  it('exchanges the code for the verified account and keeps it in a signed cookie', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push(`${init.method ?? 'GET'} ${url} ${init.body ?? ''}`);
        if (url.endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'user-token' });
        return Response.json({ payer_id: 'PAYERID123', name: 'Bhavna Patel', verified_account: 'true', emails: [{ value: 'bhavna@farmproof.test', primary: true }] });
      }),
    );

    const identity = await identityFromCode('one-time-code', 'https://farm.test');
    expect(identity).toEqual({ payerId: 'PAYERID123', email: 'bhavna@farmproof.test', name: 'Bhavna Patel', verified: true });
    expect(calls[0]).toContain('grant_type=authorization_code&code=one-time-code');

    const value = identityCookie(identity, true).split(';')[0].split('=')[1];
    expect(readIdentity(value)).toEqual(identity);
    expect(readIdentity(`${value.split('.')[0]}.tampered`)).toBeNull();
  });

  it("falls back to PayPal's own email when the account ID isn't shared", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.endsWith('/v1/oauth2/token') ? Response.json({ access_token: 'user-token' }) : Response.json({ name: 'Bhavna Patel', email: 'bhavna@farmproof.test' }))),
    );
    expect(await identityFromCode('one-time-code', 'https://farm.test')).toEqual({ payerId: null, email: 'bhavna@farmproof.test', name: 'Bhavna Patel', verified: false });
  });
});
