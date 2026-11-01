import { db } from '@/lib/db/client';
import { handle, publicOrigin, type IdContext } from '@/lib/http';
import { startVaultSetup } from '@/lib/services/premium';

export const POST = handle<IdContext>(async (request, { params }) => {
  const { id } = await params;
  const origin = publicOrigin(request);
  const { approveUrl } = await startVaultSetup(await db(), id, `${origin}/api/contracts/${id}/premium/vault/return`, `${origin}/contracts/${id}`);
  return Response.json({ approveUrl, fallback: approveUrl === null });
});
