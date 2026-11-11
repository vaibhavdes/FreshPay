import Link from 'next/link';
import { TopBar } from './ui/shell';

export default function NotFound() {
  return (
    <>
      <TopBar />
      <main className="mx-auto w-full max-w-2xl px-6 py-20 text-center sm:px-10">
        <p className="font-semibold text-leaf">Page not found</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">There&apos;s nothing at this address</h1>
        <p className="mt-3 text-canopy-soft">The link may be old, or the season it pointed to was reset. Everything is still reachable from the tour.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/tour" className="rounded-md bg-leaf px-5 py-2.5 font-semibold text-sheet hover:bg-canopy">
            Take the guided tour
          </Link>
          <Link href="/" className="rounded-md border border-canopy/25 px-5 py-2.5 font-semibold hover:border-canopy">
            Back to the home page
          </Link>
        </div>
      </main>
    </>
  );
}
