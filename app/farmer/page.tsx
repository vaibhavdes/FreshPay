import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { db } from '@/lib/db/client';
import { seasonEntry } from '@/lib/services/entry';
import { visitorSeason } from '@/lib/visitor';

export default async function FarmerEntry() {
  await connection();
  const database = await db();
  const { farmId } = await seasonEntry(database, await visitorSeason(database));
  redirect(farmId ? `/m/${farmId}` : '/');
}
