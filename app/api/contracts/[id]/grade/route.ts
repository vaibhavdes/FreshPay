import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { contracts } from '@/lib/db/schema';
import { gradeLot, isGradedCrop } from '@/lib/engine/grading';
import { handle, type IdContext } from '@/lib/http';
import { readLotSample } from '@/lib/oracles/grading';
import { OracleUnavailable } from '@/lib/oracles/evidence';
import { SAMPLE_PHOTOS } from '@/lib/photos';
import { allow, withinAiBudget } from '@/lib/rate-limit';
import { HttpError, notFound } from '@/lib/services/errors';

const MAX_BYTES = 8 * 1024 * 1024;

// Grades a sample of the delivered lot. It only suggests a quality %; the person recording the
// delivery confirms or changes it before PayPal captures anything.
export const POST = handle<IdContext>(async (request, { params }) => {
  const { id } = await params;
  const database = await db();
  const [contract] = await database.select({ commodity: contracts.commodity }).from(contracts).where(eq(contracts.id, id));
  if (!contract) throw notFound(`Contract ${id}`);
  const crop = contract.commodity;
  if (!isGradedCrop(crop)) throw new HttpError(422, `No grading rules for ${crop}`);

  const form = await request.formData();
  const file = form.get('photo');
  let photo: Uint8Array;
  let photoType = 'image/jpeg';
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) throw new HttpError(413, 'The photo is larger than 8 MB');
    // Uploaded photos call the model; the ready samples are read once and then cached.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    if (!allow(`grading:${ip}`, 20, 60 * 60_000) || !withinAiBudget('grading')) {
      return Response.json({ error: 'The AI grading limit is reached for now. Enter the quality from your own check, or try again later.' }, { status: 429 });
    }
    photo = new Uint8Array(await file.arrayBuffer());
    photoType = file.type || photoType;
  } else {
    photo = new Uint8Array(await readFile(join(process.cwd(), 'public', SAMPLE_PHOTOS[crop].src)));
  }

  try {
    const { inputHash, reading, model } = await readLotSample(database, crop, photo, photoType);
    return Response.json({ grading: gradeLot(crop, reading), reading, model, inputHash });
  } catch (error) {
    if (!(error instanceof OracleUnavailable)) throw error;
    return Response.json({ error: "AI grading isn't available right now. Enter the quality from your own check." }, { status: 503 });
  }
});
