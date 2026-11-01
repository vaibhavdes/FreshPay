import { db } from '@/lib/db/client';
import { plots } from '@/lib/db/schema';
import { refreshSatellite, satelliteCredentials } from '@/lib/services/satellite';

// Fetches a year of Sentinel-2 views for every farm in the database, so pages and claims read
// them locally. Run it where the database lives: locally, or in the Render shell.
async function main() {
  const credentials = satelliteCredentials();
  if (!credentials) throw new Error('Set SENTINEL_CLIENT_ID and SENTINEL_CLIENT_SECRET (free account at dataspace.copernicus.eu)');

  const database = await db();
  for (const plot of await database.select().from(plots)) {
    const views = await refreshSatellite(database, plot.ring, credentials);
    const clear = views.filter((v) => v.ndvi !== null);
    console.log(`${plot.id.padEnd(28)} ${clear.length}/${views.length} clear months, ${views.filter((v) => v.hasPicture).length} pictures, latest NDVI ${clear.at(-1)?.ndvi ?? '-'}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
