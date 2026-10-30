import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { db } from '@/lib/db/client';
import { demoEntry } from '@/lib/services/entry';

export default async function FarmerEntry() {
  await connection();
  const { farmId } = await demoEntry(await db());
  redirect(farmId ? `/m/${farmId}` : '/');
}
