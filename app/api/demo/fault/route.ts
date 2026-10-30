import { z } from 'zod';
import { armFault, FAULTS, type Fault } from '@/lib/faults';
import { handle, parseBody } from '@/lib/http';

const Body = z.object({ fault: z.enum(Object.keys(FAULTS) as [Fault, ...Fault[]]).nullable() });

export const POST = handle(async (request: Request) => {
  const { fault } = await parseBody(request, Body);
  armFault(fault);
  return Response.json({ armed: fault });
});
