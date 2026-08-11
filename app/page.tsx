import { redirect } from "next/navigation";

// proxy.ts already redirects an authenticated, role-assigned user away from here; this route
// is the single source of truth for "where an unauthenticated / not-yet-routed visitor goes".
export default function RootPage() {
  redirect("/login");
}
