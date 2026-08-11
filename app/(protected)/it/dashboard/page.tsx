import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";

export default async function ItDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="py-6">
      <PageHeader title="IT Dashboard" description="Your IT operations overview." />
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm text-slate-500">
          Signed in as {user?.email}. Full IT dashboard (ticket volume,
          inventory status, SLA compliance) is a future module.
        </p>
      </div>
    </div>
  );
}
