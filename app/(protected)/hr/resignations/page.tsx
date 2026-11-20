import { redirect } from "next/navigation";

// Renamed: HR > Resignations is now HR > Clearance Requests (/hr/clearance-requests). Kept as a
// redirect so old links and bookmarks still land there.
export default function OldResignationsPage() {
  redirect("/hr/clearance-requests");
}
