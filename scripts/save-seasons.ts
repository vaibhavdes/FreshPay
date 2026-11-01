import { db } from '@/lib/db/client';
import { saveSnapshot } from '@/lib/db/snapshot';
import { verifyLedger } from '@/lib/services/ledger';
async function main() {
  const database = await db();
  const ledger = await verifyLedger(database);
  if (!('ok' in ledger) || !ledger.ok) throw new Error(`ledger: ${JSON.stringify(ledger)}`);
  console.log(JSON.stringify(await saveSnapshot(database)));
}
main().catch((e) => { console.error('ERR', e?.message ?? e); process.exit(1); });
