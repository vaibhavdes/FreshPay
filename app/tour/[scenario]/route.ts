import { db } from '@/lib/db/client';
import { redirectTo } from '@/lib/http';
import { demoState } from '@/lib/services/demo';
import { seasonFor } from '@/lib/services/entry';
import { visitorSeason } from '@/lib/visitor';

// Short links to each outcome of the season, for the README and the video:
// /tour/paid, /tour/held and /tour/refused.
export async function GET(_request: Request, { params }: { params: Promise<{ scenario: string }> }) {
  const { scenario } = await params;
  const database = await db();
  const seasonId = await seasonFor(database, await visitorSeason(database));
  const state = seasonId ? await demoState(database, seasonId) : null;
  const passed = state?.plots.filter((p) => p.status === 'PASS') ?? [];
  const refused = state?.plots.find((p) => p.status === 'FAIL');

  const target: Record<string, string | undefined> = {
    paid: passed[0] && `/m/${passed[0].id}`,
    held: passed[1] && `/m/${passed[1].id}`,
    refused: refused && `/farms/${refused.id}`,
    fund: state ? `/contracts/${state.contract.id}?tab=terms` : undefined,
  };
  return redirectTo(target[scenario] ?? '/tour', 307);
}
