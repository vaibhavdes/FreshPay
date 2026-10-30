import { describe, expect, it } from 'vitest';
import { needsPass, passToken } from '@/lib/demo-pass';

describe('demo passcode', () => {
  it('guards buyer and cooperative actions but leaves farmers and reads open', () => {
    expect(needsPass('POST', '/api/contracts/c-1/force-majeure')).toBe(true);
    expect(needsPass('POST', '/api/milestones/m-1/review')).toBe(true);
    expect(needsPass('POST', '/api/disputes/d-1/send')).toBe(true);
    expect(needsPass('POST', '/api/ai/agent')).toBe(true);

    expect(needsPass('POST', '/api/milestones/m-1/claim')).toBe(false);
    expect(needsPass('POST', '/api/plots/p-1/challenges')).toBe(false);
    expect(needsPass('POST', '/api/webhooks/paypal')).toBe(false);
    expect(needsPass('GET', '/api/contracts/c-1/advance')).toBe(false);
  });

  it('stores a hash in the cookie, never the passcode', async () => {
    const token = await passToken('harvest-2026');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toContain('harvest');
    expect(await passToken('harvest-2026')).toBe(token);
  });
});
