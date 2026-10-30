import { db } from '@/lib/db/client';
import { handle, type IdContext } from '@/lib/http';
import { chargePremiumsWithVault } from '@/lib/services/premium';

export const POST = handle<IdContext>(async (_request, { params }) => {
  const { id } = await params;
  return Response.json({ payoutBatchId: await chargePremiumsWithVault(await db(), id) });
});
