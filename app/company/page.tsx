import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { db } from '@/lib/db/client';
import { seasonEntry } from '@/lib/services/entry';
import { visitorSeason } from '@/lib/visitor';

export default async function CompanyEntry({ searchParams }: PageProps<'/company'>) {
  await connection();
  const { tab, view } = await searchParams;
  const database = await db();
  const { contractId } = await seasonEntry(database, await visitorSeason(database));
  if (!contractId) redirect('/');
  if (view === 'dashboard') redirect(`/contracts/${contractId}/command-centre`);
  redirect(`/contracts/${contractId}${typeof tab === 'string' ? `?tab=${encodeURIComponent(tab)}` : ''}`);
}
