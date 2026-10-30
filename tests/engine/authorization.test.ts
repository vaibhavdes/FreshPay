import { describe, expect, it } from 'vitest';
import { authorizationAction, reauthorizeDay } from '@/lib/engine/authorization';

const DAY = 24 * 60 * 60_000;

describe('authorizationAction', () => {
  it('leaves an authorization alone while its funds are honoured', () => {
    expect(authorizationAction({ authorizedAt: 0, honouredSince: 0, now: 2 * DAY })).toBe('NONE');
  });

  it('reauthorizes once the 3-day honour period has passed, and again after the next one', () => {
    expect(authorizationAction({ authorizedAt: 0, honouredSince: 0, now: 3 * DAY })).toBe('REAUTHORIZE');
    expect(authorizationAction({ authorizedAt: 0, honouredSince: 3 * DAY, now: 5 * DAY })).toBe('NONE');
    expect(authorizationAction({ authorizedAt: 0, honouredSince: 3 * DAY, now: 6 * DAY })).toBe('REAUTHORIZE');
  });

  it('gives up on day 29, when PayPal no longer allows it', () => {
    expect(authorizationAction({ authorizedAt: 0, honouredSince: 27 * DAY, now: 29 * DAY })).toBe('EXPIRED');
  });

  it('numbers reauthorizations by day so a rerun the same day is a duplicate', () => {
    expect(reauthorizeDay(0, 3 * DAY + 5)).toBe(3);
    expect(reauthorizeDay(0, 3 * DAY + 60_000)).toBe(3);
  });
});
