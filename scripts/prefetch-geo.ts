import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { plots } from '@/lib/db/seed-data';
import { eudrStatus, type GeoCheck } from '@/lib/engine/eudr';
import { fetchTreeCoverLoss } from '@/lib/oracles/geo';

const OUT = 'lib/db/geo-checks.json';

async function main() {
  const apiKey = process.env.GFW_API_KEY;
  if (!apiKey) throw new Error('Set GFW_API_KEY (free key from data-api.globalforestwatch.org)');

  const checks: Record<string, GeoCheck> = {};
  for (const p of plots) {
    checks[p.id] = await fetchTreeCoverLoss(p.ring, apiKey);
    console.log(`${p.id.padEnd(20)} loss since 2021: ${checks[p.id].lossSince2021Ha} ha -> ${eudrStatus(checks[p.id])}`);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(checks, null, 2)}\n`);
  console.log(`Wrote ${OUT}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
