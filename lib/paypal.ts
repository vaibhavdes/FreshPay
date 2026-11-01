// PayPal REST client: every call this app makes to PayPal over plain fetch goes through here.
// Server-side only: it reads the client secret from the environment.

import { env } from './env';

export const BASE_URL = 'https://api-m.sandbox.paypal.com';
const MAX_ATTEMPTS = 4;

export class PayPalApiError extends Error {
  readonly name = 'PayPalApiError';
  readonly status: number;
  readonly path: string;
  readonly body: string;
  readonly debugId?: string;

  constructor(status: number, path: string, body: string, debugId?: string) {
    super(`PayPal ${status} on ${path}${debugId ? ` (debug_id ${debugId})` : ''}: ${body.slice(0, 300)}`);
    this.status = status;
    this.path = path;
    this.body = body;
    this.debugId = debugId;
  }
}

export type TokenResponse = { access_token: string; expires_in: number; scope: string; app_id: string };

// Always asks PayPal for a token; use accessToken() for the cached one.
// The vault account saves the buyer's PayPal for later charges. It is a second sandbox app,
// because PayPal enables Vault per app; without one, the main app is asked and declines.
export type Account = 'main' | 'vault';

function credentials(account: Account) {
  const config = env();
  if (account === 'vault' && config.PAYPAL_VAULT_CLIENT_ID && config.PAYPAL_VAULT_SECRET) return { id: config.PAYPAL_VAULT_CLIENT_ID, secret: config.PAYPAL_VAULT_SECRET };
  return { id: config.PAYPAL_CLIENT_ID, secret: config.PAYPAL_SECRET };
}

export async function requestToken(extra: Record<string, string> = {}, account: Account = 'main'): Promise<TokenResponse> {
  const { id, secret } = credentials(account);

  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', ...extra }),
    cache: 'no-store',
  });
  if (!res.ok) throw new PayPalApiError(res.status, '/v1/oauth2/token', await res.text(), res.headers.get('paypal-debug-id') ?? undefined);
  return (await res.json()) as TokenResponse;
}

// A short-lived token the JS SDK v6 can use in the browser. On a real hostname it is locked to
// that domain; PayPal rejects localhost and IP addresses as domains, so local runs go without.
// Reused until shortly before expiry, so the PayPal button doesn't wait on PayPal at every page view.
const clientTokens = new Map<string, { value: string; expiresAt: number }>();

export async function browserSafeClientToken(hostname: string): Promise<string> {
  const cached = clientTokens.get(hostname);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  const lockable = /^(?=.*[a-z])[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(hostname);
  const { access_token, expires_in } = await requestToken({ response_type: 'client_token', intent: 'sdk_init', ...(lockable && { 'domains[]': hostname }) });
  clientTokens.set(hostname, { value: access_token, expiresAt: Date.now() + (expires_in - 120) * 1000 });
  return access_token;
}

const cachedTokens = new Map<Account, { value: string; expiresAt: number }>();

async function accessToken(account: Account): Promise<string> {
  const cached = cachedTokens.get(account);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  const { access_token, expires_in } = await requestToken({}, account);
  // Refresh a minute early so an in-flight request never carries an expired token.
  cachedTokens.set(account, { value: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 });
  return access_token;
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH';
  // A string is sent as already-serialised JSON.
  body?: unknown;
  requestId?: string;
  mockResponse?: object;
  account?: Account;
};

export async function paypalRequest<T>(path: string, { method = 'GET', body, requestId, mockResponse, account = 'main' }: RequestOptions = {}): Promise<T> {
  // A mutation is only safe to resend when PayPal can dedupe it by request id.
  const retryable = method === 'GET' || requestId !== undefined;
  const isForm = body instanceof FormData;

  for (let attempt = 1; ; attempt++) {
    const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken(account)}` };
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    if (requestId) headers['PayPal-Request-Id'] = requestId;
    if (mockResponse) headers['PayPal-Mock-Response'] = JSON.stringify(mockResponse);

    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm || typeof body === 'string' ? body : JSON.stringify(body),
      cache: 'no-store',
    });
    if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;

    // A revoked or expired token: drop it and mint a new one once.
    if (res.status === 401 && attempt === 1) {
      cachedTokens.delete(account);
      continue;
    }
    if (retryable && (res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 250));
      continue;
    }
    throw new PayPalApiError(res.status, path, await res.text(), res.headers.get('paypal-debug-id') ?? undefined);
  }
}

const get = <T>(path: string, account: Account = 'main') => paypalRequest<T>(path, { account });

// `path` must already carry whatever flag makes the endpoint report `total_pages`.
async function listAll<T>(path: string, key: string, pageSize: number, account: Account = 'main'): Promise<T[]> {
  const items: T[] = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; ; page++) {
    const res = await get<{ total_pages?: number } & Record<string, unknown>>(
      `${path}${sep}page_size=${pageSize}&page=${page}`,
      account,
    );
    items.push(...((res[key] as T[] | undefined) ?? []));
    if (page >= (res.total_pages ?? 1)) return items;
  }
}

export type Money = { value: string; currency_code: string };

// --- Transaction Search & balances -------------------------------------------------

export const hasVaultAccount = () => Boolean(env().PAYPAL_VAULT_CLIENT_ID && env().PAYPAL_VAULT_SECRET);

export type Transaction = {
  transaction_info: {
    transaction_id: string;
    paypal_reference_id?: string;
    transaction_event_code?: string;
    transaction_initiation_date?: string;
    transaction_amount?: Money;
    fee_amount?: Money;
    transaction_status?: string;
    ending_balance?: Money;
    transaction_subject?: string;
    transaction_note?: string;
    custom_field?: string;
  };
  payer_info?: { email_address?: string };
};

// Transaction Search allows ranges of at most 31 days and rejects fractional seconds.
export function searchTransactions(start: Date, end: Date, account: Account = 'main'): Promise<Transaction[]> {
  const iso = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;
  return listAll<Transaction>(
    `/v1/reporting/transactions?start_date=${iso(start)}&end_date=${iso(end)}&fields=all`,
    'transaction_details',
    500,
    account,
  );
}

export type Balances = {
  as_of_time?: string;
  balances?: { currency: string; total_balance?: Money; available_balance?: Money; withheld_balance?: Money }[];
};

export function getBalances(): Promise<Balances> {
  return get<Balances>('/v1/reporting/balances');
}
