import { CampfireIcon } from "@/components/icons";

// The standard loading.tsx body — Next.js shows this instantly (via Suspense) the moment
// navigation starts, before the destination page's own data has loaded, so navigation feels
// immediate ("optimistic") instead of a blank screen until every query resolves. Practice: every
// new page/route segment gets a loading.tsx that renders this (see app/(protected)/loading.tsx
// and the per-module ones for the pattern — copy one rather than writing a new loading UI).
export function LoadingCampfire({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 py-16">
      <CampfireIcon className="h-10 w-10 animate-flame-flicker text-blue-600" />
      <p className="text-sm text-slate-400">{label}</p>
    </div>
  );
}
