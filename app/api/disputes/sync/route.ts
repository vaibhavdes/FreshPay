import { db } from '@/lib/db/client';
import { handle } from '@/lib/http';
import { syncDisputes } from '@/lib/services/disputes';

export const POST = handle(async () => Response.json({ disputes: await syncDisputes(await db()) }));
