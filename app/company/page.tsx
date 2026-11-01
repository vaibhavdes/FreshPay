import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { db } from '@/lib/db/client';
import { seasonEntry } from '@/lib/services/entry';
import { visitorSeason } from '@/lib/visitor';

export default async function CompanyEntry({ searchParams }: PageProps<'/company'>) {
  await connection();
  const { tab } = await searchParams;
  const database = await db();
  const { contractId } = await seasonEntry(database, await visitorSeason(database));
  redirect(contractId ? `/contracts/${contractId}${typeof tab === 'string' ? `?tab=${encodeURIComponent(tab)}` : ''}` : '/');
}
