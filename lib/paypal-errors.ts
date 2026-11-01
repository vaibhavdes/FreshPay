import { ApiError } from '@paypal/paypal-server-sdk';
import { PayPalApiError } from './paypal';

export type ErrorRoute = 'SHOW_THE_CUSTOMER' | 'FIX_THE_CODE' | 'RETRY_WITH_BACKOFF';

export type RoutedError = { route: ErrorRoute; issue: string; debugId?: string; message: string };

const CUSTOMER_ISSUES = new Set([
  'INSTRUMENT_DECLINED',
  'PAYER_ACTION_REQUIRED',
  'PAYER_CANNOT_PAY',
  'TRANSACTION_REFUSED',
  'ORDER_NOT_APPROVED',
  'CARD_EXPIRED',
  'PAYEE_BLOCKED_TRANSACTION',
]);

const RETRY_ISSUES = new Set(['PREVIOUS_REQUEST_IN_PROGRESS', 'INTERNAL_SERVICE_ERROR']);

export function payPalIssue(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { name?: string; error?: string; details?: { issue?: string }[] };
    return parsed.details?.[0]?.issue ?? parsed.name ?? parsed.error;
  } catch {
    return undefined;
  }
}

function routeHttp(status: number, body: string, debugId: string | undefined, message: string): RoutedError {
  const issue = payPalIssue(body) ?? `HTTP_${status}`;
  const route: ErrorRoute =
    status === 429 || status >= 500 || RETRY_ISSUES.has(issue)
      ? 'RETRY_WITH_BACKOFF'
      : CUSTOMER_ISSUES.has(issue)
        ? 'SHOW_THE_CUSTOMER'
        : 'FIX_THE_CODE';
  return { route, issue, debugId, message };
}

export function routeError(error: unknown): RoutedError {
  if (error instanceof PayPalApiError) return routeHttp(error.status, error.body, error.debugId, error.message);
  if (error instanceof ApiError) {
    const body = typeof error.body === 'string' ? error.body : JSON.stringify(error.result ?? {});
    return routeHttp(error.statusCode, body, error.headers['paypal-debug-id'], error.message);
  }
  // fetch rejects with a TypeError, and the SDK's HTTP client with a timeout or socket code, when
  // the network fails before PayPal answers: worth retrying, not a bug.
  const code = (error as { code?: unknown } | null)?.code;
  if (error instanceof TypeError || (typeof code === 'string' && ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ERR_NETWORK'].includes(code)) || (error instanceof Error && /^timeout of \d+ms exceeded$/.test(error.message))) {
    return { route: 'RETRY_WITH_BACKOFF', issue: 'NETWORK', message: error instanceof Error ? error.message : String(error) };
  }
  return { route: 'FIX_THE_CODE', issue: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) };
}
