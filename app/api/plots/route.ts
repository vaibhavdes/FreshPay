import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import { handle, parseBody } from '@/lib/http';
import { fetchTreeCoverLoss } from '@/lib/oracles/geo';
import { PlotRegistration, registerPlot, type LandChecker } from '@/lib/services/onboarding';

// Without a Global Forest Watch key, or if it doesn't answer, the plot waits for a person to check the land.
const checkLand: LandChecker = async (ring) => {
  const apiKey = env().GFW_API_KEY;
  if (!apiKey) return null;
  return fetchTreeCoverLoss(ring, apiKey).catch((error: unknown) => {
    console.error('Land check failed', error instanceof Error ? error.message : error);
    return null;
  });
};

export const POST = handle(async (request: Request) => {
  const input = await parseBody(request, PlotRegistration);
  return Response.json(await registerPlot(await db(), input, checkLand), { status: 201 });
});
