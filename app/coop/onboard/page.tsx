import type { Metadata } from 'next';
import { connection } from 'next/server';
import { db } from '@/lib/db/client';
import { contracts, cooperatives } from '@/lib/db/schema';
import { StepRail, TopBar } from '../../ui/shell';
import { OnboardForm } from './onboard-form';

export const metadata: Metadata = { title: 'Register a farmer' };

export default async function OnboardPage() {
  await connection();
  const database = await db();
  const [contract] = await database.select().from(contracts).limit(1);
  const [cooperative] = await database.select().from(cooperatives).limit(1);

  return (
    <>
    <TopBar role="officer" />
    <StepRail current={2} />
    <div className="mx-auto w-full max-w-6xl px-6 pb-16 sm:px-10">
      <section className="pt-8">
        <p className="text-canopy-soft">{cooperative?.name ?? 'Cooperative'}</p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight">Map a farm</h1>
        <p className="mt-2 text-lg text-canopy-soft">Walk the boundary with your phone. The farm joins the contract and gets its land check straight away.</p>
        <div className="mt-10">
          {contract ? (
            <OnboardForm contractId={contract.id} />
          ) : (
            <p>No season contract is set up yet.</p>
          )}
        </div>
      </section>
    </div>
    </>
  );
}
