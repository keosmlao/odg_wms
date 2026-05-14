export default function PageLoading({
  hint = "ກຳລັງດຶງຂໍ້ມູນ...",
}: {
  title?: string;
  hint?: string;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-5">
      {/* Hero skeleton with subtle gradient blob */}
      <div className="shadow-card relative overflow-hidden rounded-2xl bg-white p-7 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 animate-pulse rounded-full bg-gradient-to-br from-indigo-500/10 via-violet-500/5 to-transparent blur-3xl dark:from-indigo-500/15" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-3.5">
            <div className="h-12 w-12 shrink-0 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
            <div className="space-y-2">
              <div className="h-6 w-48 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-3 w-64 animate-pulse rounded bg-zinc-100/70 dark:bg-zinc-800/70" />
            </div>
          </div>
          <div className="space-y-2 text-right">
            <div className="ml-auto h-2.5 w-20 animate-pulse rounded bg-zinc-100/70 dark:bg-zinc-800/70" />
            <div className="ml-auto h-8 w-32 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
          </div>
        </div>
        <div className="relative mt-4 flex flex-wrap gap-1.5">
          <div className="h-6 w-20 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-6 w-28 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-6 w-24 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
        </div>
      </div>

      {/* KPI skeletons */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
          >
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-2.5 w-24 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
            <div className="mt-3 h-7 w-28 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
            <div className="mt-1 h-2 w-32 animate-pulse rounded bg-zinc-100/60 dark:bg-zinc-800/60" />
          </div>
        ))}
      </div>

      {/* Content skeleton */}
      <div className="shadow-card rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex items-center justify-between border-b border-zinc-200/70 px-5 py-4 dark:border-zinc-800/70">
          <div className="space-y-2">
            <div className="h-3.5 w-32 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-2.5 w-48 animate-pulse rounded bg-zinc-100/60 dark:bg-zinc-800/60" />
          </div>
          <div className="h-2.5 w-16 animate-pulse rounded bg-zinc-100/60 dark:bg-zinc-800/60" />
        </div>
        <div className="divide-y divide-zinc-100/70 dark:divide-zinc-800/70">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5">
              <div className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                <div className="h-2.5 w-1/3 animate-pulse rounded bg-zinc-100/60 dark:bg-zinc-800/60" />
              </div>
              <div className="h-4 w-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
          ))}
        </div>
        <div className="border-t border-zinc-200/70 px-5 py-3 text-center dark:border-zinc-800/70">
          <div className="inline-flex items-center gap-2">
            <Spinner />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 animate-spin text-indigo-500"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="3"
      />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
