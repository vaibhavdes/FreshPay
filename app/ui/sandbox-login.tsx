import { env } from '@/lib/env';

const ACCOUNTS = {
  buyer: { label: 'PayPal sandbox buyer', email: 'SANDBOX_BUYER_EMAIL', password: 'SANDBOX_BUYER_PASSWORD' },
  farmer: { label: 'PayPal sandbox farmer', email: 'SANDBOX_FARMER_EMAIL', password: 'SANDBOX_FARMER_PASSWORD' },
} as const;

// On the hosted app, the sandbox login an evaluator needs at this step. Sandbox accounts hold
// test money only; the values come from the server's settings, never the repository.
export function SandboxLogin({ account }: { account: keyof typeof ACCOUNTS }) {
  const { label, email, password } = ACCOUNTS[account];
  const [address, secret] = [process.env[email], process.env[password]];
  if (!env().SANDBOX_TOOLS || !address || !secret) return null;
  return (
    <details className="mt-3 rounded-md border border-contour bg-survey px-3 py-2 text-sm">
      <summary className="cursor-pointer font-semibold">Testing? Use the {label}</summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-canopy-soft">Email</dt>
        <dd className="select-all break-all font-mono">{address}</dd>
        <dt className="text-canopy-soft">Password</dt>
        <dd className="select-all break-all font-mono">{secret}</dd>
      </dl>
      <p className="mt-2 text-canopy-soft">Sandbox only: no real money moves.</p>
    </details>
  );
}
