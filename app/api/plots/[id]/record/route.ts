import { db } from '@/lib/db/client';
import { handle, type IdContext } from '@/lib/http';
import { plotRecord } from '@/lib/services/plot-record';

// The plot's due-diligence record as GeoJSON, ready to attach to a filing.
export const GET = handle(async (_request: Request, { params }: IdContext) => {
  const { id } = await params;
  const { geojson } = await plotRecord(await db(), id);
  return new Response(JSON.stringify(geojson, null, 2), {
    headers: {
      'Content-Type': 'application/geo+json',
      'Content-Disposition': `attachment; filename="plot-record-${id}.geojson"`,
    },
  });
});
