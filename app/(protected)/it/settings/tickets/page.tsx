import { redirect } from "next/navigation";

// Superseded by the unified /it/settings page (IT Settings redesign). Kept as a redirect so
// nothing already bookmarked breaks.
export default async function TicketSettingsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  await searchParams;
  redirect("/it/settings?tab=tickets");
}
