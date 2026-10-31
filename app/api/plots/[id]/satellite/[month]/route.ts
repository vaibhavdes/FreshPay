import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { plots } from '@/lib/db/schema';
import { viewPicture } from '@/lib/services/satellite';

// The true-colour Sentinel-2 picture of a farm for one month, as stored by the satellite refresh.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; month: string }> }) {
  const { id, month } = await params;
  if (!/^\d{4}-\d{2}$/.test(month)) return new Response('Not found', { status: 404 });

  const database = await db();
  const [plot] = await database.select({ ring: plots.ring }).from(plots).where(eq(plots.id, id));
  const picture = plot ? await viewPicture(database, plot.ring, month) : null;
  if (!picture) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(picture), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
}
