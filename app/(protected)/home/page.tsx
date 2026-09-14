import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";

export default async function EmployeeHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="py-6">
      <PageHeader title="Home" description="Your employee portal overview." />
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm text-slate-500">
          Signed in as {user?.email}. A real dashboard (per-module widgets, quick links) lands
          once modules exist to surface data from.
        </p>
      </div>
    </div>
  );
}
