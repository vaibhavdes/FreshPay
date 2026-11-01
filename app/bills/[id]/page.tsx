import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { stageTitle } from '@/lib/claim-copy';
import { db } from '@/lib/db/client';
import { formatUsd } from '@/lib/format';
import { confirmation } from '@/lib/services/confirmations';

export const metadata: Metadata = { title: 'Confirm a bill' };

const ANSWERED = {
  CONFIRMED: { tone: 'bg-leaf-wash', text: 'Thank you. You confirmed this bill, and it is recorded with the payment.' },
  DENIED: { tone: 'bg-cherry-wash text-cherry', text: "Thank you. You said this isn't your bill. The farm's next payment waits for the field officer." },
} as const;

export default async function ConfirmBill({ params }: PageProps<'/bills/[id]'>) {
  await connection();
  const { id } = await params;
  const row = await confirmation(await db(), id).catch(() => null);
  if (!row) notFound();
  const { confirmation: c } = row;

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-12">
      <p className="text-lg font-bold">FarmProof</p>
      <h1 className="mt-6 text-3xl font-bold tracking-tight">Did you issue this bill?</h1>
      <p className="mt-2 text-canopy-soft">{row.seller}, you were paid for a bill on a farm you supply. One tap tells the buyer it was really yours.</p>
      <dl className="mt-6 space-y-2 rounded-2xl border border-contour bg-sheet p-5">
        <div className="flex justify-between gap-4">
          <dt className="text-canopy-soft">Paid to you</dt>
          <dd className="font-bold tabular-nums">{formatUsd(c.cents)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-canopy-soft">Farmer</dt>
          <dd>{row.farmer}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-canopy-soft">Farm</dt>
          <dd>{row.plot}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-canopy-soft">Stage</dt>
          <dd>{stageTitle(row.type, row.stage)}</dd>
        </div>
      </dl>
      {c.status === 'WAITING' ? (
        <form action={`/api/bills/${c.id}`} method="post" className="mt-6 grid gap-3 sm:grid-cols-2">
          <button name="issued" value="yes" className="rounded-md bg-leaf px-5 py-4 text-lg font-semibold text-sheet hover:bg-canopy">
            Yes, it&apos;s my bill
          </button>
          <button name="issued" value="no" className="rounded-md border border-cherry px-5 py-4 text-lg font-semibold text-cherry hover:bg-cherry-wash">
            No, not mine
          </button>
        </form>
      ) : (
        <p className={`mt-6 rounded-xl px-4 py-3 ${ANSWERED[c.status].tone}`}>{ANSWERED[c.status].text}</p>
      )}
      <Link href={`/farms/${row.plotId}`} className="mt-6 inline-block font-semibold text-leaf underline-offset-4 hover:underline">
        See the farm&apos;s record
      </Link>
    </main>
  );
}
