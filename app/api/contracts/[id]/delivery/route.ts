import { z } from 'zod';
import { db } from '@/lib/db/client';
import { handle, parseBody, type IdContext } from '@/lib/http';
import { settleDelivery } from '@/lib/services/delivery';

const Body = z.object({
  deliveredKg: z.number().int().positive(),
  acceptedKg: z.number().int().nonnegative(),
  qualityPercent: z.number().int().min(0).max(100),
  carrier: z.string().min(1).max(80),
  trackingNumber: z.string().min(1).max(80),
  // The AI grade the person saw before confirming the quality, kept on the payment record.
  grading: z.object({ grade: z.string().max(40), suggestedPercent: z.number().int().min(0).max(100), inputHash: z.string().max(80), model: z.string().max(80) }).optional(),
});

export const POST = handle<IdContext>(async (request, { params }) => {
  const { id } = await params;
  const result = await settleDelivery(await db(), id, await parseBody(request, Body));
  return Response.json({ ...result, contract: { state: result.contract.state } });
});
