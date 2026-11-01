export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex min-h-full flex-1 flex-col bg-survey">
      <div className="h-1 overflow-hidden bg-leaf-wash">
        <div className="loading-bar h-full w-1/3 bg-leaf" />
      </div>
      <div className="border-b border-contour bg-sheet">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3 sm:px-10">
          <span className="text-lg font-bold tracking-tight">FarmProof</span>
          <span className="h-8 w-56 animate-pulse rounded-full bg-survey" />
        </div>
      </div>
      <div className="mx-auto grid w-full max-w-6xl gap-4 px-6 pt-8 sm:px-10 lg:grid-cols-2">
        <span className="h-10 w-2/3 animate-pulse rounded-lg bg-contour/60 lg:col-span-2" />
        <span className="h-56 animate-pulse rounded-3xl bg-contour/50" />
        <span className="h-56 animate-pulse rounded-3xl bg-contour/50" />
        <span className="h-32 animate-pulse rounded-2xl bg-contour/40 lg:col-span-2" />
      </div>
    </div>
  );
}
