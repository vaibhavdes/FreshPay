import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { MILESTONE_LABELS, REASON_COPY } from '@/lib/claim-copy';
import { db } from '@/lib/db/client';
import { EUDR_CUTOFF } from '@/lib/engine/eudr';
import { centroid } from '@/lib/engine/geo';
import { formatHa, formatUsd } from '@/lib/format';
import { HttpError } from '@/lib/services/errors';
import { plotRecord, type PlotRecord } from '@/lib/services/plot-record';
import { PlotOutline } from '../../ui/plot-outline';

export const metadata: Metadata = { title: 'Plot record' };

const STATE_COPY: Record<string, { text: string; tone: string }> = {
  RELEASED: { text: 'Paid', tone: 'text-leaf' },
  REVIEW: { text: 'Held for review', tone: 'text-monsoon' },
  PENDING: { text: 'Not paid yet', tone: 'text-canopy-soft' },
  REJECTED: { text: 'Refused', tone: 'text-cherry' },
};

const LAND_COPY = {
  PASS: { title: 'No forest cleared since 2020', tone: 'text-leaf' },
  REVIEW: { title: 'A person is checking the satellite result', tone: 'text-monsoon' },
  FAIL: { title: 'Forest was cleared on this plot after 2020', tone: 'text-cherry' },
} as const;

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

function Step({ step }: { step: PlotRecord['steps'][number] }) {
  const state = step.state === 'PENDING' && step.reasons.length ? STATE_COPY.REJECTED : (STATE_COPY[step.state] ?? STATE_COPY.PENDING);
  const photo = step.evidence.find((e) => e.kind === 'PHOTO');
  const voice = step.evidence.find((e) => e.kind === 'VOICE');
  const reading = photo?.reading;

  return (
    <li className="grid gap-6 border-t border-contour py-8 md:grid-cols-12">
      <div className="md:col-span-4">
        <h3 className="text-xl font-bold">{MILESTONE_LABELS[step.type].title}</h3>
        <p className={`mt-1 font-semibold ${state.tone}`}>
          {state.text}, {formatUsd(step.trancheCents)}
        </p>
        {step.reasons.map((reason) => (
          <p key={reason} className="mt-2 text-canopy-soft">
            {REASON_COPY[reason as keyof typeof REASON_COPY] ?? reason}
          </p>
        ))}
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element -- evidence is served by hash from our own route
          <img src={`/api/evidence/${photo.sha256}`} alt={`Evidence photo for ${MILESTONE_LABELS[step.type].title.toLowerCase()}`} className="mt-4 aspect-[4/3] w-full rounded-md border border-contour object-cover" />
        )}
        {voice && <audio controls src={`/api/evidence/${voice.sha256}`} className="mt-3 w-full" />}
      </div>

      <div className="md:col-span-4">
        <h4 className="font-semibold">What was checked</h4>
        {photo ? (
          <dl className="mt-2 space-y-2">
            <div>
              <dt className="text-canopy-soft">Sent from</dt>
              <dd className="tabular-nums">{photo.gps ? `${photo.gps[1].toFixed(4)} N, ${photo.gps[0].toFixed(4)} E, ${when(photo.at)}` : when(photo.at)}</dd>
            </div>
            {reading?.challengeCodeRead && (
              <div>
                <dt className="text-canopy-soft">Code read in the photo</dt>
                <dd className="font-mono">{reading.challengeCodeRead}</dd>
              </div>
            )}
            {reading?.transcript && (
              <div>
                <dt className="text-canopy-soft">Farmer said</dt>
                <dd>&ldquo;{reading.transcript}&rdquo;</dd>
              </div>
            )}
            {reading?.notes && (
              <div>
                <dt className="text-canopy-soft">Model&apos;s notes</dt>
                <dd>{reading.notes}</dd>
              </div>
            )}
            {reading?.confidence !== undefined && (
              <div>
                <dt className="text-canopy-soft">Model confidence</dt>
                <dd className="tabular-nums">{Math.round(reading.confidence * 100)}%</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="mt-2 text-canopy-soft">No evidence sent yet.</p>
        )}
      </div>

      <div className="md:col-span-4">
        <h4 className="font-semibold">How it was paid</h4>
        {step.payment ? (
          <>
            <ul className="mt-2 space-y-1">
              {step.payment.items.map((item) => (
                <li key={item.payee} className="flex justify-between gap-4">
                  <span>{item.payee}</span>
                  <span className="tabular-nums">{formatUsd(item.cents)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-canopy-soft">
              PayPal Payouts batch <span className="font-mono text-canopy">{step.payment.batchId}</span>, confirmed by{' '}
              {step.payment.confirmedBy === 'WEBHOOK' ? 'a signed webhook' : 'the API response'}.
            </p>
            {step.payment.receipts.map((r) => (
              <p key={r.seq} className="mt-1 break-all font-mono text-sm text-canopy-soft">
                Receipt {r.seq}: {r.hash.slice(0, 16)}
              </p>
            ))}
          </>
        ) : (
          <p className="mt-2 text-canopy-soft">Nothing paid for this step.</p>
        )}
      </div>
    </li>
  );
}

export default async function PlotRecordPage({ params }: PageProps<'/plots/[id]'>) {
  await connection();
  const { id } = await params;
  const record = await plotRecord(await db(), id).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  });
  const { plot, landCheck } = record;
  const land = LAND_COPY[plot.status];
  const [lng, lat] = centroid(plot.ring);
  const paidCents = record.steps.reduce((sum, s) => sum + (s.payment?.items.reduce((t, i) => t + i.cents, 0) ?? 0), 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 pb-16 sm:px-10">
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="text-xl font-bold tracking-tight">
          AgriTranche
        </Link>
        {record.contract && (
          <Link href={`/contracts/${record.contract.id}`} className="font-semibold text-leaf underline-offset-4 hover:underline">
            Season contract
          </Link>
        )}
      </header>

      <section className="grid gap-10 border-t border-contour pt-10 md:grid-cols-12">
        <div className="md:col-span-7">
          <p className="text-canopy-soft">
            Plot record{record.contract ? `, season ${record.contract.season}` : ''}
          </p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">{plot.name}</h1>
          <p className="mt-3 text-lg">
            {record.farmer}, {record.cooperative}. {plot.variety ? `${plot.variety[0].toUpperCase()}${plot.variety.slice(1)} ` : ''}
            {plot.commodity}, {formatHa(plot.areaHa)}.
          </p>
          <p className="mt-1 text-canopy-soft">{record.buyer ? `Bought by ${record.buyer}. ` : ''}Paid so far: {formatUsd(paidCents)}.</p>

          <div className="mt-8 rounded-lg border border-contour bg-sheet p-6">
            <h2 className="text-xl font-bold">Land check</h2>
            <p className={`mt-2 text-lg font-semibold ${land.tone}`}>{land.title}</p>
            <p className="mt-2 leading-relaxed text-canopy-soft">
              {landCheck
                ? `Satellite tree-cover-loss data for this plot's outline shows ${formatHa(landCheck.lossSince2021Ha)} lost after ${EUDR_CUTOFF}. Source: ${landCheck.source}.`
                : 'No satellite result yet.'}{' '}
              Buyers selling into the EU must show this for every plot, and other buyers use it to keep deforestation out of their supply.
            </p>
          </div>

          <a
            href={`/api/plots/${plot.id}/record`}
            className="mt-6 inline-block rounded-md bg-canopy px-4 py-2 font-semibold text-sheet hover:bg-canopy/90"
          >
            Download the record (GeoJSON)
          </a>
          <p className="mt-2 text-canopy-soft">The plot outline, the land check, every piece of evidence by hash and every PayPal payment, ready to file.</p>
        </div>

        <figure className="md:col-span-5">
          <PlotOutline ring={plot.ring} tone={plot.status === 'FAIL' ? 'cherry' : 'leaf'} title={`Outline of ${plot.name}`} className="mx-auto w-64" />
          <figcaption className="mt-2 text-center tabular-nums text-canopy-soft">
            {lat.toFixed(4)} N, {lng.toFixed(4)} E
          </figcaption>
        </figure>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-bold">Payments this season</h2>
        <p className="mt-2 text-canopy-soft">Each payment was released only after its evidence passed the checks. AI reads the evidence; code decides the money.</p>
        <ol className="mt-4">
          {record.steps.map((step) => (
            <Step key={step.id} step={step} />
          ))}
        </ol>
      </section>
    </div>
  );
}
