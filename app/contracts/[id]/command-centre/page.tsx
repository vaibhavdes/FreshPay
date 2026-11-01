import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import { geminiModels } from '@/lib/oracles/models';
import { commandCentreData } from '@/lib/services/command-centre';
import { StepRail, TopBar } from '../../../ui/shell';
import { CommandCentre } from './command-centre';

export const metadata: Metadata = { title: 'Command centre' };

export default async function CommandCentrePage({ params }: PageProps<'/contracts/[id]/command-centre'>) {
  await connection();
  const { id } = await params;
  const data = await commandCentreData(await db(), id);
  if (!data) notFound();

  return (
    <>
      <TopBar role="company" />
      <StepRail current={6} />
      <main className="mx-auto w-full max-w-[1600px] px-4 pb-8 pt-5 sm:px-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Season {data.contract.season} dashboard</h1>
            <p className="text-canopy-soft">
              Built with AG Grid and AG Studio. Open the AI panel and ask a question in plain words; the agent builds the chart and checks PayPal.
            </p>
          </div>
          <Link href={`/contracts/${id}`} className="font-semibold text-leaf underline-offset-4 hover:underline">
            Back to the board
          </Link>
        </div>
        <CommandCentre data={data} licenseKey={env().AG_STUDIO} agentEnabled={Boolean(geminiModels(env()))} />
      </main>
    </>
  );
}
