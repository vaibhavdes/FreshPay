const DAY = 24 * 60 * 60_000;

// PayPal honours an authorization's funds for 3 days; the authorization itself lasts 29 days and
// can be reauthorized after each 3-day honour period ends.
export const HONOR_DAYS = 3;
export const VALID_DAYS = 29;

export type AuthorizationAction = 'NONE' | 'REAUTHORIZE' | 'EXPIRED';

// `authorizedAt` is the original authorization; `honouredSince` is the latest (re)authorization.
export function authorizationAction({ authorizedAt, honouredSince, now }: { authorizedAt: number; honouredSince: number; now: number }): AuthorizationAction {
  if (now - authorizedAt >= VALID_DAYS * DAY) return 'EXPIRED';
  return now - honouredSince >= HONOR_DAYS * DAY ? 'REAUTHORIZE' : 'NONE';
}

// One reauthorization a day at most, keyed so a rerun of the same day's sweep is deduplicated.
export const reauthorizeDay = (authorizedAt: number, now: number) => Math.floor((now - authorizedAt) / DAY);
