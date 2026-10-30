import { env } from './env';

// Scheduled jobs send the shared secret; without it the job routes act as if they don't exist.
export function cronAuthorized(request: Request): boolean {
  const secret = env().CRON_SECRET;
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
}
