import { redirect } from "next/navigation";

// Renamed: a case now lives at /hr/clearance-requests/[id]. Kept as a redirect so old links and
// bookmarks still open the same case.
export default async function OldResignationCasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/hr/clearance-requests/${encodeURIComponent(id)}`);
}
