import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import { geminiModels } from '@/lib/oracles/models';
import { commandCentreData } from '@/lib/services/command-centre';
import { CommandCentre } from './command-centre';

export const metadata: Metadata = { title: 'Command centre' };

export default async function CommandCentrePage({ params }: PageProps<'/contracts/[id]/command-centre'>) {
  await connection();
  const { id } = await params;
  const data = await commandCentreData(await db(), id);
  if (!data) notFound();

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <div className="flex items-baseline gap-4">
          <Link href="/" className="text-xl font-bold tracking-tight">
            AgriTranche
          </Link>
          <span className="text-canopy-soft">Command centre, season {data.contract.season}</span>
        </div>
        <Link href={`/contracts/${id}`} className="font-semibold text-leaf underline-offset-4 hover:underline">
          Contract and payments
        </Link>
      </header>
      <CommandCentre data={data} licenseKey={env().AG_STUDIO} agentEnabled={Boolean(geminiModels(env()))} />
    </div>
  );
}
