import type { Metadata } from 'next';
import { PAYOUT_COUNTRIES } from '@/lib/countries';
import { CROP_TEMPLATES } from '@/lib/programmes';
import { TopBar } from '../../ui/shell';
import { PostForm } from './post-form';

export const metadata: Metadata = { title: 'Post an opportunity' };

export default function NewOpportunityPage() {
  return (
    <>
      <TopBar role="company" />
      <main className="mx-auto w-full max-w-5xl px-6 pb-16 pt-8 sm:px-10">
        <h1 className="text-4xl font-bold tracking-tight">Post an opportunity</h1>
        <p className="mt-2 text-lg text-canopy-soft">Pick a crop, set your price and how much you pay ahead. Each stage pays its bills the moment it is proven.</p>
        <PostForm templates={CROP_TEMPLATES} countries={PAYOUT_COUNTRIES} />
      </main>
    </>
  );
}
