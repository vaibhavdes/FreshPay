import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { MILESTONE_LABELS, REASON_COPY } from '@/lib/claim-copy';
import { db } from '@/lib/db/client';
import { agentReviews, challenges, evidence, farmers, milestones, plots } from '@/lib/db/schema';
import { formatUsd } from '@/lib/format';
import { LiveRefresh } from '../ui/live-refresh';
import { StepRail, TopBar } from '../ui/shell';
import { AgentPanel } from './agent-panel';
import { ReviewActions } from './review-actions';

export const metadata: Metadata = { title: 'Cooperative review' };

type OracleRecord = {
  reading?: { challengeCodeRead: string | null; cropStage: string; confidence: number; notes: string; transcript: string; spokenLanguage?: string | null; originalTranscript?: string | null };
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
    <>
    <TopBar role="officer" />
    <StepRail current={4} />
    <div className="mx-auto w-full max-w-5xl px-6 pb-16 sm:px-10">
      <LiveRefresh />
      <div className="flex justify-end pt-6">
        <Link href="/coop/onboard" className="font-semibold text-leaf underline-offset-4 hover:underline">
          + Map a new farm
        </Link>
      </div>

      <section className="pt-4">
        <h1 className="text-4xl font-bold tracking-tight">Proofs to check</h1>
        <p className="mt-2 text-lg text-canopy-soft">The code, farm and fund checks passed. A person needs to look at the photo, the bill or the land check.</p>
      </section>

      {held.length === 0 ? (
        <p className="mt-10 rounded-lg border border-contour bg-sheet px-6 py-8 text-lg">Nothing to check. A proof lands here when the AI isn&apos;t sure enough to pay on its own.</p>
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
                  {oracle?.reading?.originalTranscript && (
                    <p className="mt-2 leading-relaxed">
                      Farmer said, in {oracle.reading.spokenLanguage}: &ldquo;{oracle.reading.originalTranscript}&rdquo;
                    </p>
                  )}
                  {oracle?.reading?.transcript && (
                    <p className="mt-2 leading-relaxed">
                      {oracle.reading.originalTranscript ? 'In English' : 'Farmer said'}: &ldquo;{oracle.reading.transcript}&rdquo;
                    </p>
                  )}

                  <AgentPanel milestoneId={milestone.id} review={reviews.find((r) => r.milestoneId === milestone.id) ?? null} />
                  <ReviewActions
                    milestoneId={milestone.id}
                    amount={milestone.rule ? `up to ${formatUsd(milestone.trancheCents)}` : formatUsd(milestone.trancheCents)}
                    needsBill={Boolean(milestone.rule) && milestone.billCents === null}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
    </>
  );
}
