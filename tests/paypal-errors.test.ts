import { describe, expect, it } from 'vitest';
import { PayPalApiError } from '@/lib/paypal';
import { routeError } from '@/lib/paypal-errors';

const apiError = (status: number, body: object | string) =>
  new PayPalApiError(status, '/v2/checkout/orders/X/capture', typeof body === 'string' ? body : JSON.stringify(body), 'dbg-1');

describe('routeError', () => {
  it('shows the customer a declined instrument', () => {
    const routed = routeError(apiError(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] }));
    expect(routed).toMatchObject({ route: 'SHOW_THE_CUSTOMER', issue: 'INSTRUMENT_DECLINED', debugId: 'dbg-1' });
  });

  it('retries rate limits, server errors and in-flight duplicates', () => {
    expect(routeError(apiError(429, { name: 'RATE_LIMIT_REACHED' })).route).toBe('RETRY_WITH_BACKOFF');
    expect(routeError(apiError(503, 'Service Unavailable')).route).toBe('RETRY_WITH_BACKOFF');
    expect(routeError(apiError(422, { details: [{ issue: 'PREVIOUS_REQUEST_IN_PROGRESS' }] })).route).toBe('RETRY_WITH_BACKOFF');
    expect(routeError(new TypeError('fetch failed'))).toMatchObject({ route: 'RETRY_WITH_BACKOFF', issue: 'NETWORK' });
  });

  it('flags our own mistakes for the code', () => {
    expect(routeError(apiError(400, { name: 'INVALID_REQUEST', details: [{ issue: 'MISSING_REQUIRED_PARAMETER' }] }))).toMatchObject({
      route: 'FIX_THE_CODE',
      issue: 'MISSING_REQUIRED_PARAMETER',
    });
    expect(routeError(apiError(401, { error: 'invalid_client' })).issue).toBe('invalid_client');
    expect(routeError(apiError(404, '<html>')).issue).toBe('HTTP_404');
    expect(routeError(new Error('boom'))).toMatchObject({ route: 'FIX_THE_CODE', issue: 'UNKNOWN' });
  });
});

describe('network failures', () => {
  it('routes timeouts and dropped connections to retry, not to a code fix', () => {
    expect(routeError(new Error('timeout of 15000ms exceeded'))).toMatchObject({ route: 'RETRY_WITH_BACKOFF', issue: 'NETWORK' });
    expect(routeError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))).toMatchObject({ route: 'RETRY_WITH_BACKOFF', issue: 'NETWORK' });
    expect(routeError(new Error('something else'))).toMatchObject({ route: 'FIX_THE_CODE', issue: 'UNKNOWN' });
  });
});
