import { existsSync } from 'node:fs';
import { db } from '@/lib/db/client';
import { contracts } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { requestToken } from '@/lib/paypal';
import { verifyLedger } from '@/lib/services/ledger';

type Result = 'OK' | 'WARN' | 'FAIL';
type Check = { check: string; result: Result; detail: string };

const REQUIRED_SCOPES = { payouts: 'payouts', vault: 'vault', 'transaction search': 'reporting' };

async function run(check: string, fn: () => Promise<[Result, string]>): Promise<Check> {
  try {
    const [result, detail] = await fn();
    return { check, result, detail };
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : '';
    return { check, result: 'FAIL', detail: error instanceof Error ? error.message + cause : String(error) };
  }
}

async function main() {
  const checks: Check[] = [];

  checks.push(await run('environment', async () => ['OK', `PAYPAL_ENV=${env().PAYPAL_ENV}`]));
  if (checks[0].result === 'FAIL') return finish(checks);

  checks.push(
    await run('paypal credentials', async () => {
      const token = await requestToken();
      const missing = Object.entries(REQUIRED_SCOPES)
        .filter(([, fragment]) => !token.scope.includes(fragment))
        .map(([feature]) => feature);
      return missing.length ? ['WARN', `${token.app_id} lacks: ${missing.join(', ')}`] : ['OK', `${token.app_id} has payouts, vault, transaction search`];
    }),
  );

  checks.push(
    await run('database', async () => {
      const database = await db();
      const ledger = await verifyLedger(database);
      if (!ledger.ok) return ['FAIL', `ledger hash chain broken at receipt ${ledger.brokenAt}`];
      const [contract] = await database.select().from(contracts).limit(1);
      return contract ? ['OK', `${env().DATABASE_URL}, contract ${contract.id} is ${contract.state}, ledger intact`] : ['WARN', 'no data yet: run npm run seed'];
    }),
  );

  checks.push(await run('webhooks', async () => (env().PAYPAL_WEBHOOK_ID ? ['OK', 'PAYPAL_WEBHOOK_ID set'] : ['WARN', 'PAYPAL_WEBHOOK_ID not set: webhooks are rejected'])));
  checks.push(
    await run('ai oracles', async () =>
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ? ['OK', 'Gemini key set'] : ['WARN', 'no Gemini key: oracles run on recorded fixtures'],
    ),
  );
  checks.push(
    await run('eudr geo checks', async () =>
      existsSync('lib/db/geo-checks.json') ? ['OK', 'pre-fetched tree cover loss found'] : ['WARN', 'missing: run npm run prefetch:geo'],
    ),
  );

  finish(checks);
}

function finish(checks: Check[]) {
  console.table(checks);
  if (checks.some((c) => c.result === 'FAIL')) process.exitCode = 1;
}

main();
