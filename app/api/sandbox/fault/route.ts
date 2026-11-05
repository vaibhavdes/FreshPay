import { z } from 'zod';
import { armFault, FAULTS, type Fault } from '@/lib/faults';
import { handle, parseBody } from '@/lib/http';

const Body = z.object({ contractId: z.string().min(1), fault: z.enum(Object.keys(FAULTS) as [Fault, ...Fault[]]).nullable() });

export const POST = handle(async (request: Request) => {
  const { contractId, fault } = await parseBody(request, Body);
  armFault(contractId, fault);
  return Response.json({ armed: fault });
});
