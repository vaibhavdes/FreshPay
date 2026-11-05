import { describe, expect, it, vi } from 'vitest';
import { runCheats } from '@/lib/services/cheats';
import { NOW } from '../helpers';

describe('cheat runner', () => {
  it('would pay the honest claim, stops every cheat, and never calls PayPal for a claim', async () => {
    const fetch = vi.fn(async (url: string | URL) => url && Response.json({ verification_status: 'FAILURE' }));
    vi.stubGlobal('fetch', fetch);
    vi.stubEnv('PAYPAL_WEBHOOK_ID', 'WH-TEST');
    const results = await runCheats(NOW);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();

    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(byId.honest).toMatchObject({ outcome: 'WOULD_PAY' });
    expect(byId.honest.cents).toBeGreaterThan(0);
    expect(results.filter((r) => r.id !== 'honest').map((r) => [r.id, r.outcome, r.reasons])).toEqual([
      ['reused-photo', 'HELD', ['PHOTO_USED_BEFORE']],
      ['wrong-code', 'REFUSED', ['VISION_CODE_MISMATCH']],
      ['old-code', 'REFUSED', ['CHALLENGE_MISMATCH']],
      ['replay', 'REFUSED', ['CHALLENGE_USED']],
      ['away', 'REFUSED', ['OUTSIDE_PLOT']],
      ['paid-bill', 'REFUSED', ['BILL_ALREADY_PAID']],
      ['other-shop', 'HELD', ['BILL_ISSUER_MISMATCH']],
      ['old-bill', 'HELD', ['BILL_DATE_OUTSIDE']],
      ['skip', 'REFUSED', ['MILESTONE_OUT_OF_ORDER']],
      ['forest', 'REFUSED', ['EUDR_FAILED']],
      ['webhook', 'REFUSED', []],
    ]);
    expect(fetch.mock.calls.every(([url]) => String(url).includes('oauth2') || String(url).includes('verify-webhook-signature'))).toBe(true);
  });
});
