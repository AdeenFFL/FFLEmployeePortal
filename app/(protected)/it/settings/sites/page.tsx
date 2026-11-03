import { redirect } from "next/navigation";

// Superseded by the unified /it/settings page (IT Settings redesign). Kept as a redirect so
// nothing already bookmarked breaks.
export default async function SitesSettingsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; site?: string }>;
}) {
  const { site } = await searchParams;
  redirect(`/it/settings?tab=sites${site ? `&site=${site}` : ""}`);
}
