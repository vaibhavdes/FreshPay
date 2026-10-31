import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Access code' };

export default async function UnlockPage({ searchParams }: PageProps<'/unlock'>) {
  const { wrong, next } = await searchParams;
  const back = typeof next === 'string' ? next : '/';

  return (
    <div className="mx-auto w-full max-w-md px-6 py-16">
      <Link href="/" className="text-xl font-bold tracking-tight">
        FarmProof
      </Link>
      <h1 className="mt-10 text-3xl font-bold">Enter the access code</h1>
      <p className="mt-3 leading-relaxed text-canopy-soft">
        Funding, approvals, refunds and disputes move sandbox money, so they need the access code from the submission page. Farmers can send proof
        without it.
      </p>
      <form action="/api/unlock" method="post" className="mt-8 grid gap-3">
        <input type="hidden" name="next" value={back} />
        <label htmlFor="passcode" className="font-semibold">
          Access code
        </label>
        <input id="passcode" name="passcode" type="password" required autoComplete="off" className="rounded-md border border-contour bg-sheet px-3 py-2" />
        {wrong && <p className="text-cherry">That passcode didn&apos;t match. Check the submission page and try again.</p>}
        <button type="submit" className="mt-2 rounded-md bg-canopy px-4 py-2 font-semibold text-sheet hover:bg-canopy/90">
          Unlock
        </button>
      </form>
    </div>
  );
}
