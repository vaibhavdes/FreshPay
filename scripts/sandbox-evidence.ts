import { env } from '@/lib/env';
import { getBalances, paypalRequest, PayPalApiError } from '@/lib/paypal';

type Link = { href: string; rel: string };

type Order = {
  id: string;
  status: string;
  links?: Link[];
  purchase_units?: {
    payments?: {
      authorizations?: { id: string; status: string }[];
      captures?: { id: string; status: string }[];
    };
  }[];
};

type PayoutBatch = {
  batch_header: { payout_batch_id: string; batch_status: string };
  items?: { payout_item_id: string; transaction_status: string; errors?: { name?: string } }[];
};

class Skipped extends Error {}

const RETURN_URL = 'https://example.com/agritranche/return';
const CANCEL_URL = 'https://example.com/agritranche/cancel';
const BUYER_TIMEOUT_MS = 10 * 60_000;

const runId = Date.now().toString(36);
const rid = (step: string) => `agritranche-evidence-${runId}-${step}`;
const usd = (value: string) => ({ currency_code: 'USD', value });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(poll: () => Promise<T>, done: (value: T) => boolean, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await poll();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting for PayPal');
    await sleep(3000);
  }
}

function waitForBuyer<T>(what: string, links: Link[] | undefined, poll: () => Promise<T>, done: (value: T) => boolean) {
  const link = links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  if (!link) throw new Error('PayPal returned no approval link');
  console.log(`  Log in as the sandbox buyer and approve ${what}:\n  ${link.href}`);
  return waitFor(poll, done, BUYER_TIMEOUT_MS);
}

type Token = { access_token: string; scope: string; expires_in: number; app_id: string };

async function oauth(path: string, params: Record<string, string>) {
  const { PAYPAL_CLIENT_ID: id, PAYPAL_SECRET: secret } = env();
  const res = await fetch(`https://api-m.sandbox.paypal.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw new PayPalApiError(res.status, path, await res.text());
  return res;
}

// PayPal reuses a cached token whose scopes predate any app feature change, so revoke it
// and read the scopes of a freshly issued one.
async function scopes() {
  const cached = (await (await oauth('/v1/oauth2/token', { grant_type: 'client_credentials' })).json()) as Token;
  await oauth('/v1/oauth2/token/terminate', { token: cached.access_token, token_type_hint: 'ACCESS_TOKEN' });

  const token = (await (await oauth('/v1/oauth2/token', { grant_type: 'client_credentials' })).json()) as Token;
  const granted = token.scope.split(' ');
  const has = (fragment: string) => (granted.some((s) => s.includes(fragment)) ? 'yes' : 'NO');
  return `app ${token.app_id}, token expires in ${token.expires_in}s; vault ${has('vault')}, reporting ${has('reporting')}, payouts ${has('payouts')}`;
}

async function balance() {
  const { balances = [] } = await getBalances();
  const available = balances.find((b) => b.currency === 'USD')?.available_balance;
  if (!available) throw new Error('No USD balance on the platform merchant account');
  return `USD available ${available.value}`;
}

async function payout() {
  const receiver = process.env.SANDBOX_FARMER_EMAIL;
  if (!receiver) throw new Skipped('Set SANDBOX_FARMER_EMAIL to an India sandbox personal account');

  const { batch_header } = await paypalRequest<PayoutBatch>('/v1/payments/payouts', {
    method: 'POST',
    requestId: rid('payout'),
    body: {
      sender_batch_header: {
        sender_batch_id: rid('payout'),
        email_subject: 'AgriTranche sandbox payout',
        recipient_type: 'EMAIL',
      },
      items: [{ amount: { value: '1.00', currency: 'USD' }, receiver, sender_item_id: 'farmer-1', note: 'Day 1 sandbox check' }],
    },
  });

  const batch = await waitFor(
    () => paypalRequest<PayoutBatch>(`/v1/payments/payouts/${batch_header.payout_batch_id}`),
    (b) => !['PENDING', 'PROCESSING'].includes(b.batch_header.batch_status),
    2 * 60_000,
  );
  const item = batch.items?.[0];
  const detail = `batch ${batch_header.payout_batch_id} ${batch.batch_header.batch_status}, item ${item?.payout_item_id} ${item?.transaction_status}`;
  if (item?.transaction_status !== 'SUCCESS') throw new Error(`${detail} ${item?.errors?.name ?? ''}`.trim());
  return detail;
}

async function authorization() {
  const order = await paypalRequest<Order>('/v2/checkout/orders', {
    method: 'POST',
    requestId: rid('auth-order'),
    body: {
      intent: 'AUTHORIZE',
      purchase_units: [{ reference_id: 'lot-1', description: 'Coffee lot balance (sandbox check)', amount: usd('100.00') }],
      payment_source: {
        paypal: {
          experience_context: { return_url: RETURN_URL, cancel_url: CANCEL_URL, shipping_preference: 'NO_SHIPPING', user_action: 'CONTINUE' },
        },
      },
    },
  });
  await waitForBuyer(
    'the $100.00 authorization',
    order.links,
    () => paypalRequest<Order>(`/v2/checkout/orders/${order.id}`),
    (o) => o.status === 'APPROVED',
  );

  const mocked = await paypalRequest(`/v2/checkout/orders/${order.id}/authorize`, {
    method: 'POST',
    body: {},
    requestId: rid('auth-mock'),
    mockResponse: { mock_application_codes: 'INSTRUMENT_DECLINED' },
  }).then(
    () => 'not applied',
    (error: unknown) => (error instanceof PayPalApiError && error.body.includes('INSTRUMENT_DECLINED') ? `INSTRUMENT_DECLINED ${error.status}` : String(error)),
  );

  const authorized = await paypalRequest<Order>(`/v2/checkout/orders/${order.id}/authorize`, {
    method: 'POST',
    body: {},
    requestId: rid('auth'),
  });
  const authorizationId = authorized.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
  if (!authorizationId) throw new Error(`Order ${order.id} returned no authorization`);

  const capture = await paypalRequest<{ id: string; status: string }>(`/v2/payments/authorizations/${authorizationId}/capture`, {
    method: 'POST',
    requestId: rid('partial-capture'),
    body: { amount: usd('92.00'), final_capture: false },
  });
  await paypalRequest(`/v2/payments/authorizations/${authorizationId}/void`, { method: 'POST', body: {}, requestId: rid('void') });
  const { status } = await paypalRequest<{ status: string }>(`/v2/payments/authorizations/${authorizationId}`);

  return `order ${order.id}, authorization ${authorizationId}, capture ${capture.id} $92.00 ${capture.status}, remainder voided (${status}); mock decline: ${mocked}`;
}

async function vault() {
  const setup = await paypalRequest<{ id: string; status: string; links?: Link[] }>('/v3/vault/setup-tokens', {
    method: 'POST',
    requestId: rid('setup-token'),
    body: {
      payment_source: {
        paypal: {
          description: 'AgriTranche traceability premium mandate',
          usage_pattern: 'UNSCHEDULED_POSTPAID',
          usage_type: 'MERCHANT',
          customer_type: 'CONSUMER',
          permit_multiple_payment_tokens: false,
          experience_context: { return_url: RETURN_URL, cancel_url: CANCEL_URL, shipping_preference: 'NO_SHIPPING' },
        },
      },
    },
  });
  await waitForBuyer(
    'the traceability mandate (no purchase)',
    setup.links,
    () => paypalRequest<{ status: string }>(`/v3/vault/setup-tokens/${setup.id}`),
    (t) => !['CREATED', 'PAYER_ACTION_REQUIRED'].includes(t.status),
  );

  const token = await paypalRequest<{ id: string }>('/v3/vault/payment-tokens', {
    method: 'POST',
    requestId: rid('payment-token'),
    body: { payment_source: { token: { id: setup.id, type: 'SETUP_TOKEN' } } },
  });

  const order = await paypalRequest<Order>('/v2/checkout/orders', {
    method: 'POST',
    requestId: rid('mit-order'),
    body: {
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: 'plot-premium-1', description: 'Traceability premium, 1 verified plot (sandbox check)', amount: usd('5.00') }],
      payment_source: { paypal: { vault_id: token.id } },
    },
  });
  const captured =
    order.status === 'COMPLETED'
      ? order
      : await paypalRequest<Order>(`/v2/checkout/orders/${order.id}/capture`, { method: 'POST', body: {}, requestId: rid('mit-capture') });
  const captureId = captured.purchase_units?.[0]?.payments?.captures?.[0]?.id;

  return `setup token ${setup.id}, payment token ${token.id}, merchant-initiated order ${order.id}, capture ${captureId} ${captured.status}`;
}

async function disputes() {
  const { items = [] } = await paypalRequest<{ items?: { dispute_id: string; status: string }[] }>('/v1/customer/disputes?page_size=10');
  const listed = items.map((d) => `${d.dispute_id} ${d.status}`).join(', ') || 'none';

  const disputeId = process.env.EVIDENCE_DISPUTE_ID;
  if (!disputeId) throw new Skipped(`Disputes listed: ${listed}. File one as the sandbox buyer, then set EVIDENCE_DISPUTE_ID`);

  const input = {
    evidences: [{ evidence_type: 'OTHER', notes: 'Lot delivered and accepted at QC. Weight slip and per-plot EUDR record are on file.' }],
  };
  const form = new FormData();
  form.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }));
  await paypalRequest(`/v1/customer/disputes/${disputeId}/provide-evidence`, { method: 'POST', body: form });

  const { status } = await paypalRequest<{ status: string }>(`/v1/customer/disputes/${disputeId}`);
  return `evidence provided on ${disputeId} (${status})`;
}

const checks: Record<string, () => Promise<string>> = { scopes, balance, payout, authorization, vault, disputes };

async function main() {
  env();

  const selected = process.argv.slice(2);
  const unknown = selected.filter((name) => !(name in checks));
  if (unknown.length) throw new Error(`Unknown check(s): ${unknown.join(', ')}. Available: ${Object.keys(checks).join(', ')}`);

  const results: { check: string; result: 'PASS' | 'FAIL' | 'SKIP'; detail: string }[] = [];
  for (const [check, run] of Object.entries(checks)) {
    if (selected.length && !selected.includes(check)) continue;
    console.log(`\n${check}`);
    try {
      results.push({ check, result: 'PASS', detail: await run() });
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : '';
      const detail = error instanceof Error ? error.message + cause : String(error);
      results.push({ check, result: error instanceof Skipped ? 'SKIP' : 'FAIL', detail });
    }
    const { result, detail } = results[results.length - 1];
    console.log(`  ${result}: ${detail}`);
  }

  console.log();
  console.table(results);
  if (results.some((r) => r.result === 'FAIL')) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
