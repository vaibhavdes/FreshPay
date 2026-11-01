import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { BILL_LABEL } from '@/lib/claim-copy';
import { payoutCountry } from '@/lib/countries';
import { db } from '@/lib/db/client';
import type { SupplierKind } from '@/lib/engine/gate';
import { formatHa, formatUsd } from '@/lib/format';
import { cropTemplate } from '@/lib/programmes';
import { HttpError } from '@/lib/services/errors';
import { opportunity } from '@/lib/services/opportunities';
import { IDENTITY_COOKIE, readIdentity } from '@/lib/paypal-identity';
import { OnboardForm } from '../../coop/onboard/onboard-form';
import { TopBar } from '../../ui/shell';

export const metadata: Metadata = { title: 'Opportunity' };

const LAND = { PASS: 'Land check passed', REVIEW: 'Land check with a person', FAIL: 'Forest cleared after 2020' } as const;
const STATE = { DRAFT: 'Waiting for the company to fund it', FUNDED: 'Funded: stages pay as they are proven', ACTIVE: 'Funded: stages pay as they are proven', DELIVERING: 'Crop being delivered', SETTLED: 'Season settled', FRUSTRATED: 'Ended by a verified weather event' } as const;

export default async function OpportunityPage({ params, searchParams }: PageProps<'/opportunities/[id]'>) {
  await connection();
  const { id } = await params;
  const { paypal } = await searchParams;
  const signedIn = readIdentity((await cookies()).get(IDENTITY_COOKIE)?.value);
  const o = await opportunity(await db(), id).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  });
  const template = cropTemplate(o.templateId);
  const valuePerHa = Math.round((o.terms.yieldKgPerHa * o.terms.priceCentsPerKg) / 100) * 100;
  const open = o.contract.state === 'DRAFT' || o.contract.state === 'FUNDED' || o.contract.state === 'ACTIVE';

  return (
    <>
      <TopBar />
      <main className="mx-auto w-full max-w-6xl px-6 pb-16 pt-8 sm:px-10">
        <Link href="/opportunities" className="text-canopy-soft hover:text-canopy">
          ← All opportunities
        </Link>
        <p className="mt-4 text-canopy-soft">
          {o.company} · farmers in {o.region}, {payoutCountry(o.country)?.name ?? o.country}
        </p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight">{o.title}</h1>
        <p className="mt-3 inline-block rounded-full bg-survey px-4 py-1.5 font-semibold">{STATE[o.contract.state]}</p>

        <section className="mt-8 grid gap-6 md:grid-cols-3">
          <div className="rounded-xl border border-contour bg-sheet p-5">
            <p className="text-canopy-soft">A hectare is worth</p>
            <p className="text-3xl font-bold tabular-nums">{formatUsd(valuePerHa)}</p>
            <p className="mt-1 text-sm text-canopy-soft">
              {o.terms.yieldKgPerHa.toLocaleString('en-US')} kg at {formatUsd(o.terms.priceCentsPerKg)} a kg
            </p>
          </div>
          <div className="rounded-xl border border-contour bg-sheet p-5">
            <p className="text-canopy-soft">Paid through the season</p>
            <p className="text-3xl font-bold tabular-nums">{o.terms.advancePercent}%</p>
            <p className="mt-1 text-sm text-canopy-soft">The rest when the crop is delivered and graded</p>
          </div>
          <div className="rounded-xl border border-contour bg-sheet p-5">
            <p className="text-canopy-soft">Land joined</p>
            <p className="text-3xl font-bold tabular-nums">
              {formatHa(o.hectaresJoined)} <span className="text-lg font-normal text-canopy-soft">of {formatHa(o.hectaresWanted)}</span>
            </p>
            <p className="mt-1 text-sm text-canopy-soft">Apply by {o.applyBy}</p>
          </div>
        </section>
        {template && <p className="mt-3 text-sm text-canopy-soft">Starting figures: {template.basis}.</p>}

        <section className="mt-10">
          <h2 className="text-2xl font-bold">How each stage pays</h2>
          <ol className="mt-4 grid gap-3 md:grid-cols-5">
            {Object.entries(o.terms.stages).map(([type, s], i) => (
              <li key={type} className="rounded-xl border border-contour bg-sheet p-4">
                <p className="text-sm text-canopy-soft">Stage {i + 1}</p>
                <p className="font-bold">{s.label}</p>
                <p className="mt-2 text-sm">
                  {type === 'PLOT_VERIFIED'
                    ? '$25 to the farmer'
                    : [...(Object.entries(s.caps) as [SupplierKind, number][]).map(([kind, cap]) => `${BILL_LABEL[kind]} up to ${cap}%`), `farmer ${s.farmerPercent}%`].join(', ')}
                </p>
                <p className="mt-2 text-xs text-canopy-soft tabular-nums">
                  {s.opensAt} to {s.closesAt}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {o.farms.length > 0 && (
          <section className="mt-10">
            <h2 className="text-2xl font-bold">Farms that joined</h2>
            <ul className="mt-4 divide-y divide-contour rounded-xl border border-contour bg-sheet">
              {o.farms.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                  <Link href={`/farms/${f.id}`} className="font-semibold underline-offset-4 hover:underline">
                    {f.farmer}, {f.name}
                  </Link>
                  <span className="text-canopy-soft">{formatHa(f.areaHa)}</span>
                  <span className="text-canopy-soft">{LAND[f.landCheck]}</span>
                  <span className="ml-auto font-semibold tabular-nums">{formatUsd(f.valueCents)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href={`/contracts/${o.contract.id}?tab=terms`} className="rounded-md bg-canopy px-4 py-2 font-semibold text-sheet hover:bg-canopy/90">
                {o.contract.state === 'DRAFT' ? `Company: fund ${formatUsd(o.contract.advanceCents)} with PayPal` : 'Open the contract board'}
              </Link>
              <Link href={`/m/${o.farms[0].id}`} className="rounded-md border border-canopy/25 px-4 py-2 font-semibold hover:border-canopy">
                Open a farmer&apos;s phone
              </Link>
            </div>
          </section>
        )}

        {open && (
          <section className="mt-12">
            <h2 className="text-2xl font-bold">Join with your farm</h2>
            <p className="mt-1 text-canopy-soft">Walk the boundary or paste its corners. The satellite land check runs as soon as you join.</p>
            {paypal === 'failed' && <p className="mt-4 rounded-md bg-cherry-wash px-4 py-3 text-cherry">PayPal sign-in didn&apos;t finish. Try again, or type your PayPal email.</p>}
            <div className="mt-6">
              <OnboardForm
                contractId={o.contract.id}
                crop={template?.crop ?? o.terms.crop}
                signInHref={`/api/auth/paypal?next=${encodeURIComponent(`/opportunities/${o.id}`)}`}
                signedIn={signedIn && { name: signedIn.name, email: signedIn.email, verified: signedIn.verified }}
              />
            </div>
          </section>
        )}
      </main>
    </>
  );
}
