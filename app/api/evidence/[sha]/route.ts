import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const EVIDENCE_DIR = join(process.cwd(), 'data/evidence');
const TYPES: Record<string, string> = { jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', webm: 'audio/webm', mp4: 'audio/mp4', ogg: 'audio/ogg' };

// Evidence is stored by content hash, so the hash is the only way to ask for a file.
export async function GET(_request: Request, { params }: { params: Promise<{ sha: string }> }) {
  const { sha } = await params;
  if (!/^[0-9a-f]{64}$/.test(sha)) return new Response('Not found', { status: 404 });

  const name = (await readdir(EVIDENCE_DIR).catch(() => [])).find((file) => file.startsWith(`${sha}.`));
  if (!name) return new Response('Not found', { status: 404 });

  const type = TYPES[name.split('.').pop()!] ?? 'application/octet-stream';
  return new Response(await readFile(join(EVIDENCE_DIR, name)), { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable' } });
}
