import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './env';
import { BASE_URL, PayPalApiError } from './paypal';

// Log in with PayPal for farmers: they sign in with their own PayPal account, and the app gets
// the account's payer id and verified email to pay, instead of an address typed by hand.

const AUTHORIZE_URL = 'https://www.sandbox.paypal.com/connect/';
// The account-ID scope must be ticked in the app's Log in with PayPal settings; without it PayPal
// refuses the whole request, so it can be switched off and payouts fall back to PayPal's own email.
const scopes = () => (env().PAYPAL_LOGIN_ACCOUNT_ID ? 'openid profile email https://uri.paypal.com/services/paypalattributes' : 'openid profile email');
export const IDENTITY_COOKIE = 'fp_paypal';
const MAX_AGE_S = 60 * 60;

// payerId is null when the account-ID attribute isn't shared; the email still comes from PayPal.
export type PayPalIdentity = { payerId: string | null; email: string; name: string; verified: boolean };

const sign = (value: string) => createHmac('sha256', env().CHALLENGE_SECRET).update(value).digest('base64url');

function sealed(value: object): string {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${body}.${sign(body)}`;
}

function opened<T>(token: string | undefined): T | null {
  const [body, mac] = token?.split('.') ?? [];
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return JSON.parse(Buffer.from(body, 'base64url').toString()) as T;
}

export const returnUrl = (origin: string) => `${env().APP_URL ?? origin}/api/auth/paypal/callback`;

// Where to send the browser to sign in. `next` comes back in the signed state, so a forged
// callback can't redirect anywhere else.
export function authorizeUrl(origin: string, next: string): string {
  const state = sealed({ next: next.startsWith('/') && !next.startsWith('//') ? next : '/opportunities', nonce: randomBytes(8).toString('hex') });
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({ flowEntry: 'static', client_id: env().PAYPAL_CLIENT_ID, response_type: 'code', scope: scopes(), redirect_uri: returnUrl(origin), state }).toString();
  return url.toString();
}

export const readState = (state: string | null) => opened<{ next: string }>(state ?? undefined);

type UserInfo = { payer_id?: string; email?: string; name?: string; verified_account?: string | boolean; emails?: { value: string; primary?: boolean }[] };

// Swaps the one-time code for the signed-in account's details.
export async function identityFromCode(code: string, origin: string): Promise<PayPalIdentity> {
  const { PAYPAL_CLIENT_ID: id, PAYPAL_SECRET: secret } = env();
  const tokenRes = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: returnUrl(origin) }),
    cache: 'no-store',
  });
  if (!tokenRes.ok) throw new PayPalApiError(tokenRes.status, '/v1/oauth2/token', await tokenRes.text(), tokenRes.headers.get('paypal-debug-id') ?? undefined);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const path = '/v1/identity/openidconnect/userinfo?schema=openid';
  const infoRes = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${access_token}` }, cache: 'no-store' });
  if (!infoRes.ok) throw new PayPalApiError(infoRes.status, path, await infoRes.text(), infoRes.headers.get('paypal-debug-id') ?? undefined);
  const info = (await infoRes.json()) as UserInfo;

  const email = info.email ?? info.emails?.find((e) => e.primary)?.value ?? info.emails?.[0]?.value;
  if (!email) throw new Error('PayPal did not share the email; tick Email address in the app\'s Log in with PayPal settings');
  return { payerId: info.payer_id ?? null, email, name: info.name ?? email, verified: info.verified_account === true || info.verified_account === 'true' };
}

export const identityCookie = (identity: PayPalIdentity, secure: boolean) =>
  `${IDENTITY_COOKIE}=${sealed(identity)}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

export const readIdentity = (token: string | undefined) => opened<PayPalIdentity>(token);
