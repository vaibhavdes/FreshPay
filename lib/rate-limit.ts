// A small in-memory sliding window: enough for one Render instance and a public app.
const hits = new Map<string, number[]>();

export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

// Every AI route has a daily budget shared by all callers, so a public app can't run up the model bill.
const AI_DAILY = { agent: 300, review: 100, dispute: 50 } as const;

export const withinAiBudget = (route: keyof typeof AI_DAILY) => allow(`ai:${route}`, AI_DAILY[route], 24 * 60 * 60_000);
