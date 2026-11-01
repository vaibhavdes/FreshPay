import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { REASON_COPY, stageTitle } from '@/lib/claim-copy';
import { db } from '@/lib/db/client';
import { plots as examplePlots } from '@/lib/db/seed-data';
import { formatHa, formatUsd } from '@/lib/format';
import { HttpError } from '@/lib/services/errors';
import { plotRecord, type PlotRecord } from '@/lib/services/plot-record';
import { refreshInBackground, viewsOf } from '@/lib/services/satellite';
import { LiveRefresh } from '../../ui/live-refresh';
import { PaymentFlow } from '../../ui/payment-flow';
import { SatelliteMap } from '../../ui/satellite-map';
import { SatelliteTimeline } from '../../ui/satellite-timeline';
import { SignalList } from '../../ui/signal-list';
import { NextStep, StepRail, TopBar } from '../../ui/shell';
import { StageMark, stageStatus, STATUS_TEXT, type StageStatus } from '../../ui/stage-mark';

export const metadata: Metadata = { title: 'Farm record' };

type Stage = PlotRecord['steps'][number];
type Tick = { label: string; state: 'pass' | 'wait' | 'fail'; points: number };

const LAND = {
  PASS: { text: 'Land check passed: no forest cleared since 2020', tone: 'bg-leaf-wash text-canopy' },
  REVIEW: { text: 'Land check: a person is looking at the satellite result', tone: 'bg-monsoon-wash text-canopy' },
  FAIL: { text: 'Land check failed: forest cleared after 2020', tone: 'bg-cherry-wash text-cherry' },
} as const;

// The checks of one proof, read from the gate's reasons; a paid stage passed all of them. Points
// make the result readable at a glance; the gate's own rules, not the score, decide payment.
function ticksFor(stage: Stage): Tick[] {
  const has = (...reasons: string[]) => reasons.some((r) => stage.reasons.includes(r) || stage.approvedAfter.includes(r));
  const state = (fail: boolean, wait = false): Tick['state'] => (fail ? 'fail' : wait ? 'wait' : 'pass');
  const ticks: Tick[] = [
    { label: "Today's code in the photo", points: 30, state: state(has('VISION_CODE_MISMATCH', 'CHALLENGE_MISSING', 'CHALLENGE_MISMATCH', 'CHALLENGE_EXPIRED', 'CHALLENGE_USED'), has('ORACLE_UNAVAILABLE')) },
    { label: 'Sent from the farm', points: 20, state: state(has('OUTSIDE_PLOT')) },
    { label: 'AI reading is sure', points: 20, state: state(false, has('LOW_CONFIDENCE', 'ORACLE_UNAVAILABLE')) },
    { label: 'Land check', points: 20, state: state(has('EUDR_FAILED'), has('EUDR_REVIEW')) },
    { label: 'Season fund covers it', points: 10, state: state(has('ESCROW_EXCEEDED')) },
    { label: 'Photo and bills not used before', points: 20, state: state(has('BILL_ALREADY_PAID'), has('PHOTO_USED_BEFORE', 'BILL_ISSUER_MISMATCH', 'BILL_DATE_OUTSIDE')) },
    { label: 'Camera, weather and satellite agree', points: 10, state: state(false, has('PROOF_SIGNAL_WARNING')) },
  ];
  if (stage.rule) ticks.splice(3, 0, { label: 'Bill total read', points: 20, state: state(false, has('BILL_UNREADABLE')) });
  return ticks;
}

function proofScore(ticks: Tick[], approved: boolean) {
  const max = ticks.reduce((sum, t) => sum + t.points, 0);
  const got = ticks.reduce((sum, t) => sum + (t.state === 'pass' ? t.points : t.state === 'wait' ? t.points / 2 : 0), 0);
  const score = Math.round((got / max) * 100);
  const band =
    score >= 80
      ? { label: 'Strong', tone: 'var(--at-leaf)' }
      : approved
        ? { label: 'Approved after review', tone: 'var(--at-leaf)' }
        : score >= 50
          ? { label: 'Needs review', tone: 'var(--at-monsoon)' }
          : { label: 'Weak', tone: 'var(--at-cherry)' };
  return { score, ...band };
}

const seconds = (ms: number) => (ms < 90_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`);

// How long the money took: from the proof arriving to PayPal accepting the payout, and to
// PayPal's webhook saying it reached everyone.
function Stopwatch({ proofAt, payment }: { proofAt: number; payment: NonNullable<Stage['payment']> }) {
  if (payment.syncMs === null) return null;
  const accepted = payment.sentAt + payment.syncMs - proofAt;
  return (
    <p className="mt-2 text-sm">
      <span className="font-semibold">Proof to PayPal: {seconds(Math.max(accepted, 0))}</span>
      {payment.webhookMs !== null && <span className="text-canopy-soft"> · money confirmed {seconds(payment.sentAt + payment.webhookMs - proofAt)} after the proof</span>}
    </p>
  );
}

function ScoreRing({ ticks, approved }: { ticks: Tick[]; approved: boolean }) {
  const { score, label, tone } = proofScore(ticks, approved);
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90" role="img" aria-label={`Proof score ${score} of 100, ${label}`}>
        <circle cx={32} cy={32} r={r} fill="none" stroke="var(--at-contour)" strokeWidth={7} />
        <circle cx={32} cy={32} r={r} fill="none" stroke={tone} strokeWidth={7} strokeDasharray={`${(score / 100) * c} ${c}`} strokeLinecap="round" />
        <text x={32} y={37} textAnchor="middle" fontSize={17} fontWeight={700} fill="var(--at-canopy)" transform="rotate(90 32 32)">
          {score}
        </text>
      </svg>
      <div>
        <p className="font-bold" style={{ color: tone }}>
          {label}
        </p>
        <p className="text-sm text-canopy-soft">Proof score</p>
      </div>
    </div>
  );
}

const TICK_STYLE = { pass: 'text-leaf', wait: 'text-monsoon', fail: 'text-cherry' } as const;
const TICK_GLYPH = { pass: '✓', wait: '…', fail: '✕' } as const;

function StageCard({ stage, status }: { stage: Stage; status: StageStatus }) {
  const photo = stage.evidence.find((e) => e.kind === 'PHOTO');
  const voice = stage.evidence.find((e) => e.kind === 'VOICE');
  const reading = photo?.reading;
  const paid = stage.payment?.items.reduce((sum, i) => sum + i.cents, 0) ?? 0;

  return (
    <li id={stage.type} className="scroll-mt-24 rounded-xl border border-contour bg-sheet p-5">
      <div className="flex flex-wrap items-center gap-3">
        <StageMark status={status} />
        <h3 className="text-lg font-bold">{stageTitle(stage.type, stage.label)}</h3>
        <span className="text-canopy-soft">{STATUS_TEXT[status]}</span>
        <span className="ml-auto font-semibold tabular-nums">{paid ? formatUsd(paid) : stage.rule ? `up to ${formatUsd(stage.trancheCents)}` : formatUsd(stage.trancheCents)}</span>
      </div>

      {photo ? (
        <div className="mt-4 grid gap-5 md:grid-cols-[1fr_1fr_1.4fr]">
          {/* eslint-disable-next-line @next/next/no-img-element -- evidence is served by hash from our own route */}
          <img src={`/api/evidence/${photo.sha256}`} alt={`Proof photo for ${stageTitle(stage.type, stage.label).toLowerCase()}`} className="aspect-[4/3] w-full rounded-lg border border-contour object-cover" />
          <div>
            <ScoreRing ticks={ticksFor(stage)} approved={stage.approvedAfter.length > 0} />
            {stage.approvedAfter.length > 0 && <p className="mt-2 text-sm font-semibold text-monsoon">Approved by the field officer after a check</p>}
            <ul className="mt-3 space-y-1.5">
              {ticksFor(stage).map((t) => (
                <li key={t.label} className="flex gap-2">
                  <span aria-hidden className={`font-bold ${TICK_STYLE[t.state]}`}>
                    {TICK_GLYPH[t.state]}
                  </span>
                  <span className="flex-1">{t.label}</span>
                  <span className="text-sm text-canopy-soft tabular-nums">
                    {t.state === 'pass' ? t.points : t.state === 'wait' ? t.points / 2 : 0}/{t.points}
                  </span>
                </li>
              ))}
            </ul>
            {reading?.transcript && (
              <p className="mt-3 text-sm text-canopy-soft">
                {reading.originalTranscript ? `Said in ${reading.spokenLanguage}: ` : 'Said: '}&ldquo;{reading.transcript}&rdquo;
              </p>
            )}
            {voice && <audio controls src={`/api/evidence/${voice.sha256}`} className="mt-2 w-full" />}
            {photo.signals.length > 0 && <SignalList signals={photo.signals} />}
          </div>
          <div>
            {stage.payment ? (
              <>
                <PaymentFlow payees={stage.payment.items.map((item) => ({ name: item.payee, role: item.role, cents: item.cents, status: item.status }))} batchId={stage.payment.batchId} />
                <p className="mt-1 text-xs text-canopy-soft">Confirmed by {stage.payment.confirmedBy === 'WEBHOOK' ? 'a signed PayPal webhook' : 'the PayPal API'}</p>
                <Stopwatch proofAt={photo.at} payment={stage.payment} />
                {stage.payment.receipts.length > 0 && (
                  <p className="mt-1 text-xs">
                    Payment record:{' '}
                    {stage.payment.receipts.map((r) => (
                      <Link key={r.seq} href={`/verify/${r.hash}`} className="mr-2 font-mono underline-offset-2 hover:underline">
                        #{r.seq}
                      </Link>
                    ))}
                  </p>
                )}
              </>
            ) : (
              stage.reasons[0] && <p className="text-canopy-soft">{REASON_COPY[stage.reasons[0] as keyof typeof REASON_COPY] ?? stage.reasons[0]}</p>
            )}
          </div>
        </div>
      ) : (
        stage.reasons[0] && <p className="mt-3 text-canopy-soft">{REASON_COPY[stage.reasons[0] as keyof typeof REASON_COPY] ?? stage.reasons[0]}</p>
      )}
    </li>
  );
}

export default async function FarmRecordPage({ params }: PageProps<'/farms/[id]'>) {
  await connection();
  const { id } = await params;
  const database = await db();
  const record = await plotRecord(database, id).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  });
  const { plot } = record;
  const views = await viewsOf(database, plot.ring);
  // The example season's farms (and visitors' copies of them) say where their outline comes from.
  const outline = examplePlots.find((p) => plot.id === p.id || plot.id.startsWith(`${p.id}-`))?.outline;
  refreshInBackground(database, plot.ring);
  const next = record.steps.find((s) => s.state !== 'RELEASED');
  const statuses = record.steps.map((s) => (plot.status === 'FAIL' && s.state !== 'RELEASED' ? ('refused' as const) : stageStatus(s, s.id === next?.id)));
  const paidCents = record.steps.reduce((sum, s) => sum + (s.payment?.items.reduce((t, i) => t + i.cents, 0) ?? 0), 0);
  const land = LAND[plot.status];

  return (
    <>
      <LiveRefresh />
      <TopBar role="company" />
      <StepRail current={5} />
      <main className="mx-auto w-full max-w-6xl px-6 pb-16 pt-8 sm:px-10">
        <section className="grid gap-8 md:grid-cols-12">
          <div className="md:col-span-7">
            <p className="text-canopy-soft">
              {record.farmer} · {record.cooperative}
            </p>
            <h1 className="mt-1 text-4xl font-bold tracking-tight">{plot.name}</h1>
            <p className="mt-1 text-canopy-soft">
              {plot.variety ? `${plot.variety[0].toUpperCase()}${plot.variety.slice(1)}` : plot.commodity} · {formatHa(plot.areaHa)}
              {record.buyer ? ` · for ${record.buyer}` : ''}
            </p>
            <p className={`mt-5 inline-block rounded-full px-4 py-1.5 font-semibold ${land.tone}`}>{land.text}</p>

            <ol aria-label="Stages" className="mt-8 flex items-start">
              {record.steps.map((stage, i) => (
                <li key={stage.id} className="flex flex-1 flex-col items-start">
                  <div className="flex w-full items-center">
                    <a href={`#${stage.type}`}>
                      <StageMark status={statuses[i]} size="lg" />
                    </a>
                    {i < record.steps.length - 1 && <span aria-hidden className={`mx-1 h-0.5 flex-1 ${statuses[i] === 'paid' ? 'bg-leaf' : 'bg-contour'}`} />}
                  </div>
                  <p className="mt-2 pr-2 text-sm font-semibold leading-tight">{stageTitle(stage.type, stage.label)}</p>
                </li>
              ))}
            </ol>

            <div className="mt-8 flex flex-wrap items-center gap-6">
              <div>
                <p className="text-canopy-soft">Paid for this farm</p>
                <p className="text-3xl font-bold tabular-nums">{formatUsd(paidCents)}</p>
              </div>
              <a href={`/api/plots/${plot.id}/record`} className="rounded-md border border-canopy/25 px-4 py-2 font-semibold hover:border-canopy">
                Download farm record
              </a>
            </div>
          </div>
          <div className="md:col-span-5">
            <SatelliteMap plots={[{ id: plot.id, name: plot.name, ring: plot.ring, status: plot.status }]} width={420} title={`Satellite view of ${plot.name} with its outline`} />
            {outline && (
              <p className="mt-2 text-xs text-canopy-soft">
                Outline: {outline.startsWith('OpenStreetMap') ? `${outline}, © OpenStreetMap contributors (ODbL)` : outline}. A demonstration outline, not an ownership record.
              </p>
            )}
          </div>
        </section>

        <SatelliteTimeline plotId={plot.id} ring={plot.ring} commodity={plot.commodity} views={views} />

        <ol className="mt-10 space-y-4">
          {record.steps.map((stage, i) => (
            <StageCard key={stage.id} stage={stage} status={statuses[i]} />
          ))}
        </ol>

        <NextStep
          href={record.contract ? `/contracts/${record.contract.id}` : '/company'}
          label="See every farm on the contract"
          note={<Link href={`/m/${plot.id}`} className="font-semibold text-leaf underline-offset-4 hover:underline">Open the farmer&apos;s phone</Link>}
        />
      </main>
    </>
  );
}
