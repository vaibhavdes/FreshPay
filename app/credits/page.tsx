import type { Metadata } from 'next';
import Image from 'next/image';
import { SAMPLE_PHOTOS, STAGE_PHOTOS } from '@/lib/photos';
import { templateFor } from '@/lib/programmes';
import { stageTitle } from '@/lib/claim-copy';
import { PLOT_MILESTONES } from '@/lib/engine/stateMachine';
import { TopBar } from '../ui/shell';

export const metadata: Metadata = { title: 'Photo credits' };

export default function Credits() {
  return (
    <>
      <TopBar />
      <main className="mx-auto w-full max-w-6xl px-6 pb-16 pt-8 sm:px-10">
        <h1 className="text-4xl font-bold tracking-tight">Photo credits</h1>
        <p className="mt-2 max-w-2xl text-canopy-soft">
          Every farm photo comes from Wikimedia Commons under a Creative Commons licence or in the public domain. They are resized; the ready photos for testing add a
          code and bills on top.
        </p>
        {Object.entries(STAGE_PHOTOS).map(([commodity, photos]) => {
          const template = templateFor(commodity);
          return (
            <section key={commodity} className="mt-10">
              <h2 className="text-2xl font-bold">
                {template.crop} <span className="font-normal text-canopy-soft">· {template.region}</span>
              </h2>
              <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
                {[...PLOT_MILESTONES, 'SAMPLE' as const].map((type) => {
                  const photo = type === 'SAMPLE' ? SAMPLE_PHOTOS[commodity] : photos[type];
                  if (!photo) return null;
                  return (
                    <li key={type} className="overflow-hidden rounded-xl border border-contour bg-sheet">
                      <div className="relative aspect-[4/3]">
                        <Image src={photo.src} alt={photo.alt} fill sizes="(min-width: 1024px) 20vw, 50vw" className="object-cover" />
                      </div>
                      <div className="p-3 text-sm">
                        <p className="font-semibold">{type === 'SAMPLE' ? 'Delivery sample for grading' : stageTitle(type, template.terms.stages[type].label)}</p>
                        <p className="mt-1 text-canopy-soft">
                          <a href={photo.page} className="underline underline-offset-2">
                            {photo.author}
                          </a>
                          ,{' '}
                          <a href={photo.licenseUrl} className="underline underline-offset-2">
                            {photo.license}
                          </a>
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </main>
    </>
  );
}
