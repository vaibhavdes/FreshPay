import { db } from '@/lib/db/client';
import { handle } from '@/lib/http';
import { runReconciliation } from '@/lib/services/reconciliation';

export const POST = handle(async () => Response.json(await runReconciliation(await db())));
