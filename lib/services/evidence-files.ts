import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { evidenceFiles } from '../db/schema';

export async function saveEvidenceFile(db: Db, bytes: Uint8Array, contentType: string, now = Date.now()): Promise<string> {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await db.insert(evidenceFiles).values({ sha256, contentType, bytes: Buffer.from(bytes), createdAt: now }).onConflictDoNothing();
  return sha256;
}

export async function evidenceFile(db: Db, sha256: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string } | null> {
  const [row] = await db.select({ bytes: evidenceFiles.bytes, type: evidenceFiles.contentType }).from(evidenceFiles).where(eq(evidenceFiles.sha256, sha256));
  return row ? { bytes: new Uint8Array(row.bytes), type: row.type } : null;
}
