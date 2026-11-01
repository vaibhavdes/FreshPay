import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, desc, eq, notLike } from 'drizzle-orm';
import { REVIEW_FIXTURES, type RecordedReview } from '@/lib/agents/review-agent';
import { db } from '@/lib/db/client';
import { agentReviews, evidence, oracleReadings } from '@/lib/db/schema';

// Saves every real Gemini reading made locally as a fixture, so the hosted demo (AI_MODE=replay)
// gives the same answers for the same evidence without calling a model.
async function main() {
  const dir = join(process.cwd(), 'lib/oracles/fixtures');
  mkdirSync(dir, { recursive: true });
  const database = await db();
  const rows = (await database.select().from(oracleReadings)).filter((r) => r.model !== 'replay');
  for (const row of rows) writeFileSync(join(dir, `${row.inputHash}.json`), `${JSON.stringify(row.reading, null, 2)}\n`);
  console.log(`Saved ${rows.length} reading(s) to lib/oracles/fixtures`);

  // The latest live review of each held photo, so the hosted review agent can replay it.
  mkdirSync(REVIEW_FIXTURES, { recursive: true });
  const reviews = await database
    .select({ review: agentReviews, photo: evidence.sha256 })
    .from(agentReviews)
    .innerJoin(evidence, and(eq(evidence.milestoneId, agentReviews.milestoneId), eq(evidence.kind, 'PHOTO')))
    .where(notLike(agentReviews.model, 'recorded %'))
    .orderBy(desc(agentReviews.createdAt));
  const saved = new Set<string>();
  for (const { review, photo } of reviews) {
    if (saved.has(photo)) continue;
    saved.add(photo);
    const recorded: RecordedReview = { model: review.model, recommendation: review.recommendation, confidence: review.confidence, summary: review.summary, reasons: review.reasons, checks: review.checks };
    writeFileSync(join(REVIEW_FIXTURES, `${photo}.json`), `${JSON.stringify(recorded, null, 2)}\n`);
  }
  console.log(`Saved ${saved.size} agent review(s) to lib/agents/fixtures`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
