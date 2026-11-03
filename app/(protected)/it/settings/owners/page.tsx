import { redirect } from "next/navigation";

// Superseded by the unified /it/settings page (IT Settings redesign) — owner assignment now
// lives inline on the category/task rows there instead of its own tab. Kept as a redirect so
// nothing already bookmarked breaks.
export default async function OwnersRedirect({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; track?: string; site?: string }>;
}) {
  const { track, site } = await searchParams;
  const tab = track === "tasks" ? "onboarding" : "tickets";
  redirect(`/it/settings?tab=${tab}${site ? `&site=${site}` : ""}`);
}
