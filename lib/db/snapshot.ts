import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { desc } from 'drizzle-orm';
import type { Db } from './client';
import * as schema from './schema';

// Seasons run for real against the PayPal sandbox and Gemini, saved row for row so the hosted
// app can show them as they happened. Tables are listed children first: that is the order to
// clear them in, and the reverse is the order to fill them.
export const SEASON_TABLES = {
  disputes: schema.disputes,
  reconciliation_runs: schema.reconciliationRuns,
  premiums: schema.premiums,
  agent_reviews: schema.agentReviews,
  bill_fingerprints: schema.billFingerprints,
  evidence: schema.evidence,
  evidence_files: schema.evidenceFiles,
  challenges: schema.challenges,
  payout_items: schema.payoutItems,
  paypal_ops: schema.paypalOps,
  webhook_events: schema.webhookEvents,
  ledger_receipts: schema.ledgerReceipts,
  eudr_records: schema.eudrRecords,
  mandates: schema.mandates,
  milestones: schema.milestones,
  opportunities: schema.opportunities,
  contracts: schema.contracts,
  plots: schema.plots,
  input_dealers: schema.inputDealers,
  farmers: schema.farmers,
  cooperatives: schema.cooperatives,
  buyers: schema.buyers,
  oracle_readings: schema.oracleReadings,
  satellite_views: schema.satelliteViews,
} as const;

type Name = keyof typeof SEASON_TABLES;
type Snapshot = { lastReceipt: string; rows: Record<Name, Record<string, unknown>[]> };

export const SNAPSHOT_DIR = join(process.cwd(), 'lib/db/snapshot');
const DATA = 'seasons.json';

const exists = (dir: string) => existsSync(join(dir, DATA));
export const hasSnapshot = (dir = SNAPSHOT_DIR) => exists(dir);

export async function saveSnapshot(db: Db, dir = SNAPSHOT_DIR) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'files'), { recursive: true });
  const rows = {} as Snapshot['rows'];
  for (const [name, table] of Object.entries(SEASON_TABLES) as [Name, (typeof SEASON_TABLES)[Name]][]) {
    const all = (await db.select().from(table)) as Record<string, unknown>[];
    rows[name] =
      name === 'evidence_files'
        ? all.map(({ bytes, ...file }) => {
            writeFileSync(join(dir, 'files', String(file.sha256)), bytes as Buffer);
            return file;
          })
        : all;
  }
  const [last] = await db.select({ hash: schema.ledgerReceipts.hash }).from(schema.ledgerReceipts).orderBy(desc(schema.ledgerReceipts.seq)).limit(1);
  writeFileSync(join(dir, DATA), JSON.stringify({ lastReceipt: last?.hash ?? '', rows } satisfies Snapshot));
  return Object.fromEntries(Object.entries(rows).map(([name, list]) => [name, list.length]));
}

export function snapshotReceipt(dir = SNAPSHOT_DIR): string | null {
  return exists(dir) ? (JSON.parse(readFileSync(join(dir, DATA), 'utf8')) as Snapshot).lastReceipt : null;
}

export async function clearSeasons(db: Db | Parameters<Parameters<Db['transaction']>[0]>[0]) {
  for (const table of Object.values(SEASON_TABLES)) await db.delete(table);
}

export async function restoreSnapshot(db: Db, dir = SNAPSHOT_DIR) {
  const { rows } = JSON.parse(readFileSync(join(dir, DATA), 'utf8')) as Snapshot;
  await db.transaction(async (tx) => {
    await clearSeasons(tx);
    for (const name of (Object.keys(SEASON_TABLES) as Name[]).reverse()) {
      const list = name === 'evidence_files' ? rows[name].map((file) => ({ ...file, bytes: readFileSync(join(dir, 'files', String(file.sha256))) })) : rows[name];
      for (let i = 0; i < list.length; i += 200) await tx.insert(SEASON_TABLES[name]).values(list.slice(i, i + 200) as never);
    }
  });
}
