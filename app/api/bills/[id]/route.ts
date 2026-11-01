import { db } from '@/lib/db/client';
import { redirectTo } from '@/lib/http';
import { answerConfirmation } from '@/lib/services/confirmations';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const form = await request.formData();
  await answerConfirmation(await db(), id, form.get('issued') === 'yes').catch(() => null);
  return redirectTo(`/bills/${id}`, 303);
}
