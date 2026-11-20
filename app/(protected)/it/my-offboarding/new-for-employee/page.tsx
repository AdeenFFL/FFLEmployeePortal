import { redirect } from "next/navigation";

// Retired: starting an offboarding for an employee is now "Start clearance for an employee" on
// HR > Resignations. Kept as a redirect so old links still land there (the route itself is gated
// on hr.clearance.read_all in lib/auth/route-permissions.ts).
export default function NewSiteOffboardingPage() {
  redirect("/hr/resignations");
}
