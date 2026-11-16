import { redirect } from "next/navigation";

// Retired: self-offboarding is now the HR clearance request on the profile page (Offboarding
// card). Kept as a redirect so old links and bookmarks still land somewhere useful.
export default function NewSelfOffboardingPage() {
  redirect("/profile");
}
