import { db } from '@/lib/db/client';
import { handle, redirectTo, type IdContext } from '@/lib/http';
import { chargePremiumsWithVault, completeVaultSetup } from '@/lib/services/premium';

// PayPal sends the buyer back here after approving the mandate.
export const GET = handle<IdContext>(async (_request, { params }) => {
  const { id } = await params;
  const database = await db();
  await completeVaultSetup(database, id);
  await chargePremiumsWithVault(database, id);
  return redirectTo(`/contracts/${id}`, 303);
});
