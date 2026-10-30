import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { MILESTONE_LABELS, REASON_COPY } from '@/lib/claim-copy';
import { db } from '@/lib/db/client';
import { agentReviews, challenges, evidence, farmers, milestones, plots } from '@/lib/db/schema';
import { formatUsd } from '@/lib/format';
import { LiveRefresh } from '../ui/live-refresh';
import { AgentPanel } from './agent-panel';
import { ReviewActions } from './review-actions';

export const metadata: Metadata = { title: 'Cooperative review' };

type OracleRecord = {
  reading?: { challengeCodeRead: string | null; cropStage: string; confidence: number; notes: string; transcript: string };
  source?: { kind: string; model: string };
};

export default async function CoopReview() {
  await connection();
  const database = await db();

  const held = await database
    .select({ milestone: milestones, plot: plots, farmer: farmers.name })
    .from(milestones)
    .innerJoin(plots, eq(milestones.plotId, plots.id))
    .innerJoin(farmers, eq(plots.farmerId, farmers.id))
    .where(eq(milestones.state, 'REVIEW'))
    .orderBy(desc(milestones.decidedAt));

  const items = held.length ? await database.select().from(evidence).where(inArray(evidence.milestoneId, held.map((h) => h.milestone.id))).orderBy(desc(evidence.createdAt)) : [];
  const reviews = held.length
    ? await database.select().from(agentReviews).where(inArray(agentReviews.milestoneId, held.map((h) => h.milestone.id))).orderBy(desc(agentReviews.createdAt))
    : [];
  const issued = items.length
    ? await database.select({ id: challenges.id, code: challenges.code }).from(challenges).where(inArray(challenges.id, items.flatMap((e) => (e.challengeId ? [e.challengeId] : []))))
    : [];

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16 sm:px-10">
      <LiveRefresh />
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="text-xl font-bold tracking-tight">
          AgriTranche
        </Link>
        <span className="text-canopy-soft">Malnad Coffee Growers FPO</span>
      </header>

      <section className="border-t border-contour pt-10">
        <h1 className="text-4xl font-bold tracking-tight">Claims waiting for you</h1>
        <p className="mt-3 max-w-2xl text-lg leading-relaxed text-canopy-soft">
          These passed the code, location, timing and funds checks, but the photo or the satellite result needs a person. Approving pays the farmer
          straight away; refusing asks them for new evidence.
        </p>
      </section>

      {held.length === 0 ? (
        <p className="mt-10 rounded-lg border border-contour bg-sheet px-6 py-8 text-lg">Nothing is waiting. New claims appear here when the AI is not confident enough to pay on its own.</p>
      ) : (
        <ul className="mt-10 space-y-6">
          {held.map(({ milestone, plot, farmer }) => {
            const photo = items.find((e) => e.milestoneId === milestone.id && e.kind === 'PHOTO');
            const voice = items.find((e) => e.milestoneId === milestone.id && e.kind === 'VOICE');
            const oracle = (photo?.oracle ?? null) as OracleRecord | null;
            const code = issued.find((c) => c.id === photo?.challengeId)?.code;
            const reasons = ((milestone.decision as { reasons?: (keyof typeof REASON_COPY)[] } | null)?.reasons ?? []).map((r) => REASON_COPY[r]);

            return (
              <li key={milestone.id} className="grid gap-6 rounded-lg border border-contour bg-sheet p-6 md:grid-cols-[18rem_1fr]">
                <div>
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- evidence is served by hash from local storage
                    <img src={`/api/evidence/${photo.sha256}`} alt={`Evidence photo for ${plot.name}`} className="aspect-[4/3] w-full rounded-md object-cover" />
                  ) : (
                    <p className="grid aspect-[4/3] place-items-center rounded-md bg-survey text-canopy-soft">No photo</p>
                  )}
                  {voice && <audio src={`/api/evidence/${voice.sha256}`} controls className="mt-3 w-full" />}
                </div>

                <div>
                  <p className="text-canopy-soft">
                    {farmer}, {plot.name}
                  </p>
                  <h2 className="mt-1 text-2xl font-bold">
                    {MILESTONE_LABELS[milestone.type].title}: {formatUsd(milestone.trancheCents)}
                  </h2>
                  <ul className="mt-3 space-y-1">
                    {reasons.map((reason) => (
                      <li key={reason} className="rounded-md bg-monsoon-wash px-3 py-2">
                        {reason}
                      </li>
                    ))}
                  </ul>

                  <dl className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-canopy-soft">Code issued</dt>
                      <dd className="font-mono text-lg font-bold">{code ?? 'none'}</dd>
                    </div>
                    <div>
                      <dt className="text-canopy-soft">Code read by AI</dt>
                      <dd className="font-mono text-lg font-bold">{oracle?.reading ? (oracle.reading.challengeCodeRead ?? 'not legible') : 'no reading'}</dd>
                    </div>
                    {oracle?.reading && (
                      <>
                        <div>
                          <dt className="text-canopy-soft">Crop stage</dt>
                          <dd>{oracle.reading.cropStage.toLowerCase().replace('_', ' ')}</dd>
                        </div>
                        <div>
                          <dt className="text-canopy-soft">AI confidence</dt>
                          <dd>
                            {Math.round(oracle.reading.confidence * 100)}%{oracle.source ? `, ${oracle.source.model}` : ''}
                          </dd>
                        </div>
                      </>
                    )}
                  </dl>
                  {oracle?.reading?.notes && <p className="mt-4 leading-relaxed text-canopy-soft">AI notes: {oracle.reading.notes}</p>}
                  {oracle?.reading?.transcript && <p className="mt-2 leading-relaxed">Farmer said: &ldquo;{oracle.reading.transcript}&rdquo;</p>}

                  <AgentPanel milestoneId={milestone.id} review={reviews.find((r) => r.milestoneId === milestone.id) ?? null} />
                  <ReviewActions milestoneId={milestone.id} amount={formatUsd(milestone.trancheCents)} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
