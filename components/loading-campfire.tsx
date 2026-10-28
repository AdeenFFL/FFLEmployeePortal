import { CampfireIcon } from "@/components/icons";

// A continuous rising-ash stream above the flame tip — every particle shares roughly the same X
// position (a tight cluster, not spread sideways) so it reads as one column, not several
// separate puffs. Vertical spacing comes from two combined things: each particle STARTS at a
// different height (`top`, spread well apart up the column) and each is also staggered in time
// (`delay`, evenly across the loop), so at any instant you see several specks strung out at
// clearly different heights, each still independently rising and fading out as it goes — a
// steady loop, not particles bunched on top of each other. `top`/`left` are percentages of the
// icon's own rendered size (not fixed px), so particles stay anchored to the flame regardless
// of icon size.
// Delays are evenly spaced across the 2.4s loop defined by globals.css's ash-rise animation.
const ASH_PARTICLES = [
  { left: "44%", top: "0%", delay: "0s", drift: "-4px" },
  { left: "46%", top: "8%", delay: "0.48s", drift: "4px" },
  { left: "42%", top: "16%", delay: "0.96s", drift: "-5px" },
  { left: "48%", top: "24%", delay: "1.44s", drift: "5px" },
  { left: "45%", top: "32%", delay: "1.92s", drift: "-3px" },
];

// The standard loading.tsx body — Next.js shows this instantly (via Suspense) the moment
// navigation starts, before the destination page's own data has loaded, so navigation feels
// immediate ("optimistic") instead of a blank screen until every query resolves. Practice: every
// new page/route segment gets a loading.tsx that renders this (see app/(protected)/loading.tsx
// and the per-module ones for the pattern — copy one rather than writing a new loading UI).
export function LoadingCampfire({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 py-16">
      <div className="relative">
        {ASH_PARTICLES.map((p, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="animate-ash-rise absolute h-2 w-2 rounded-full bg-slate-600"
            style={{
              left: p.left,
              top: p.top,
              animationDelay: p.delay,
              boxShadow: "0 0 4px 1px rgba(71, 85, 105, 0.5)",
              ["--ash-drift" as string]: p.drift,
            }}
          />
        ))}
        <CampfireIcon className="h-24 w-24 animate-flame-flicker" />
      </div>
      <p className="text-sm text-slate-400">{label}</p>
    </div>
  );
}
