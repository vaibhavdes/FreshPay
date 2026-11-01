import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { ledgerReceipts } from '@/lib/db/schema';
import { canonicalJson, isIntact } from '@/lib/engine/ledger';
import { verifyLedger } from '@/lib/services/ledger';
import { TopBar } from '../../ui/shell';

export const metadata: Metadata = { title: 'Verify a payment record' };

// Anyone holding a payment record's hash can check it here: that it hashes to itself, which
// record came before it, and that the whole chain of records is unbroken.
export default async function VerifyPage({ params }: PageProps<'/verify/[hash]'>) {
  await connection();
  const { hash } = await params;
  if (!/^[0-9a-f]{64}$/.test(hash)) notFound();

  const database = await db();
  const [receipt] = await database.select().from(ledgerReceipts).where(eq(ledgerReceipts.hash, hash));
  if (!receipt) notFound();
  const [previous] = receipt.seq > 0 ? await database.select().from(ledgerReceipts).where(eq(ledgerReceipts.seq, receipt.seq - 1)) : [];
  const [next] = await database.select().from(ledgerReceipts).where(eq(ledgerReceipts.prevHash, receipt.hash));
  const intact = isIntact(receipt);
  const chain = await verifyLedger(database);

  const checks = [
    { ok: intact, text: intact ? 'This record hashes to its own hash: nothing in it was changed.' : 'This record no longer matches its hash: it was changed after it was written.' },
    { ok: receipt.seq === 0 || previous?.hash === receipt.prevHash, text: `It follows record #${receipt.seq - 1 < 0 ? 'none' : receipt.seq - 1}, whose hash it carries.` },
    { ok: chain.ok, text: chain.ok ? 'Every record before and after it still links up.' : `The chain breaks at record #${chain.brokenAt}.` },
  ];

  return (
    <>
      <TopBar />
      <main className="mx-auto w-full max-w-3xl px-6 pb-16 pt-8 sm:px-10">
        <h1 className="text-4xl font-bold tracking-tight">Payment record #{receipt.seq}</h1>
        <p className="mt-2 text-canopy-soft">Written {new Date(receipt.createdAt).toUTCString()}. Each record carries the hash of the one before, so no payment can be edited or removed quietly.</p>

        <ul className="mt-6 space-y-2">
          {checks.map((c) => (
            <li key={c.text} className={`rounded-md px-4 py-3 ${c.ok ? 'bg-leaf-wash' : 'bg-cherry-wash text-cherry'}`}>
              <span className="font-bold">{c.ok ? '✓' : '✕'}</span> {c.text}
            </li>
          ))}
        </ul>

        <h2 className="mt-8 text-xl font-bold">What it records</h2>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-contour bg-sheet p-4 text-sm">{JSON.stringify(receipt.payload, null, 2)}</pre>

        <dl className="mt-6 grid gap-2 font-mono text-xs break-all">
          <dt className="font-sans font-semibold">Hash</dt>
          <dd>{receipt.hash}</dd>
          <dt className="font-sans font-semibold">Previous hash</dt>
          <dd>{receipt.prevHash}</dd>
          <dt className="font-sans font-semibold">Hashed as</dt>
          <dd>sha256(&quot;{receipt.seq}\n{receipt.prevHash.slice(0, 12)}…\n&quot; + canonical JSON, {canonicalJson(receipt.payload).length} characters)</dd>
        </dl>

        <nav className="mt-8 flex justify-between">
          {previous ? <Link href={`/verify/${previous.hash}`} className="font-semibold underline-offset-4 hover:underline">← #{previous.seq}</Link> : <span />}
          {next && <Link href={`/verify/${next.hash}`} className="font-semibold underline-offset-4 hover:underline">#{next.seq} →</Link>}
        </nav>
      </main>
    </>
  );
}
