import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runReviewAgent } from '@/lib/agents/review-agent';
import { SCENARIOS, createScenario } from '@/lib/agents/eval-scenarios';
import { openDb } from '@/lib/db/client';
import { env } from '@/lib/env';

// Scores the review agent against held claims with known right answers, on a throwaway database.
async function main() {
  const db = await openDb(`file:${join(tmpdir(), `agritranche-eval-${randomUUID()}.db`)}`);
  console.log(`Review agent on ${env().AGENT_MODEL} via ${env().AI_PROVIDER}\n`);

  const results = [];
  for (const scenario of SCENARIOS) {
    const milestoneId = await createScenario(db, scenario);
    try {
      const review = await runReviewAgent(db, milestoneId);
      if (!review) throw new Error('No AI model configured');
      results.push({
        scenario: scenario.name,
        expected: scenario.expected,
        agent: review.recommendation,
        confidence: review.confidence,
        checks: review.checks.map((c) => c.tool).join(', '),
        result: review.recommendation === scenario.expected ? 'PASS' : 'MISS',
      });
    } catch (error) {
      results.push({ scenario: scenario.name, expected: scenario.expected, agent: '-', confidence: '-', checks: '-', result: `ERROR ${error instanceof Error ? error.message : error}` });
    }
  }

  console.table(results);
  const passed = results.filter((r) => r.result === 'PASS').length;
  console.log(`\n${passed} of ${results.length} decided as a careful officer would.`);
  if (passed < results.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
