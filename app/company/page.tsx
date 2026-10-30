import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { db } from '@/lib/db/client';
import { demoEntry } from '@/lib/services/entry';

export default async function CompanyEntry({ searchParams }: PageProps<'/company'>) {
  await connection();
  const { tab } = await searchParams;
  const { contractId } = await demoEntry(await db());
  redirect(contractId ? `/contracts/${contractId}${typeof tab === 'string' ? `?tab=${encodeURIComponent(tab)}` : ''}` : '/');
}
