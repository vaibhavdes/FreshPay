import { handle } from '@/lib/http';
import { runCheats } from '@/lib/services/cheats';

export const POST = handle(async () => Response.json({ results: await runCheats() }));
