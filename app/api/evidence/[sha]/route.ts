import { db } from '@/lib/db/client';
import { evidenceFile } from '@/lib/services/evidence-files';

// Evidence is stored by content hash, so the hash is the only way to ask for a file.
export async function GET(_request: Request, { params }: { params: Promise<{ sha: string }> }) {
  const { sha } = await params;
  if (!/^[0-9a-f]{64}$/.test(sha)) return new Response('Not found', { status: 404 });

  const file = await evidenceFile(await db(), sha);
  if (!file) return new Response('Not found', { status: 404 });
  return new Response(file.bytes, { headers: { 'Content-Type': file.type, 'Cache-Control': 'private, max-age=31536000, immutable' } });
}
