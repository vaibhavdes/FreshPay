import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { env } from '../env';
import * as schema from './schema';

export type Db = ReturnType<typeof connect>;

function connect(url: string, authToken?: string) {
  if (url.startsWith('file:')) mkdirSync(dirname(url.slice('file:'.length)), { recursive: true });
  return drizzle(createClient({ url, authToken }), { schema });
}

export async function openDb(url: string, authToken?: string): Promise<Db> {
  const db = connect(url, authToken);
  await db.run('PRAGMA foreign_keys = ON');
  if (url.startsWith('file:')) await db.run('PRAGMA journal_mode = WAL');
  await migrate(db, { migrationsFolder: join(process.cwd(), 'lib/db/migrations') });
  return db;
}

// One connection per process; kept on globalThis so Next.js hot reloads reuse it.
const holder = globalThis as typeof globalThis & { agritrancheDb?: Promise<Db> };

export function db(): Promise<Db> {
  if (!holder.agritrancheDb) {
    const { DATABASE_URL, DATABASE_AUTH_TOKEN } = env();
    holder.agritrancheDb = openDb(DATABASE_URL, DATABASE_AUTH_TOKEN).catch((error: unknown) => {
      holder.agritrancheDb = undefined;
      throw error;
    });
  }
  return holder.agritrancheDb;
}
