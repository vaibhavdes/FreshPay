import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

// Render's health check: the app is up and its database answers.
export async function GET() {
  await (await db()).run(sql`select 1`);
  return Response.json({ ok: true });
}
