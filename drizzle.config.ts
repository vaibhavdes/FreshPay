import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'turso',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'file:data/agritranche.db' },
});
