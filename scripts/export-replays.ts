import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '@/lib/db/client';
import { oracleReadings } from '@/lib/db/schema';

// Saves every real Gemini reading made locally as a fixture, so the hosted demo (AI_MODE=replay)
// gives the same answers for the same evidence without calling a model.
async function main() {
  const dir = join(process.cwd(), 'lib/oracles/fixtures');
  mkdirSync(dir, { recursive: true });
  const rows = (await (await db()).select().from(oracleReadings)).filter((r) => r.model !== 'replay');
  for (const row of rows) writeFileSync(join(dir, `${row.inputHash}.json`), `${JSON.stringify(row.reading, null, 2)}\n`);
  console.log(`Saved ${rows.length} reading(s) to lib/oracles/fixtures`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
