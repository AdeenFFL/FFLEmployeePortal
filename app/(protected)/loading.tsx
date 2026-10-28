import { LoadingCampfire } from "@/components/loading-campfire";

// Covers every page under (protected) by default (Next.js cascades loading.tsx down the route
// tree) — shown instantly via Suspense while a page's own data is still loading, so navigation
// feels immediate instead of a blank screen. A specific route/module can add its own
// loading.tsx (same <LoadingCampfire />, optionally a different label) to override this one
// when it wants a more tailored message; it doesn't need to for the campfire itself.
export default function Loading() {
  return <LoadingCampfire />;
}
