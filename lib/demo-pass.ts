// The hosted demo is public, so buyer and cooperative actions (funding, approvals, refunds,
// disputes, the agent) need a passcode. Farmers' evidence stays open: the gate checks it anyway.
export const PASS_COOKIE = 'agritranche_pass';

const OPERATOR_PATHS = [
  /^\/api\/contracts\//,
  /^\/api\/milestones\/[^/]+\/(review|agent-review)$/,
  /^\/api\/disputes\//,
  /^\/api\/reconciliation$/,
  /^\/api\/buyers\//,
  /^\/api\/ai\/agent$/,
  /^\/api\/plots$/,
  /^\/api\/demo\//,
];

export const needsPass = (method: string, pathname: string) => method !== 'GET' && OPERATOR_PATHS.some((p) => p.test(pathname));

// The cookie holds a hash of the passcode, never the passcode itself.
export async function passToken(passcode: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`agritranche-demo:${passcode}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
