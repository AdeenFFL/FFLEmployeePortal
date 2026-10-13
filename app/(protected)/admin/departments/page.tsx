import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { OrgUnitTable } from "@/components/org-unit-table";
import { OrgUnitFormPanel } from "@/components/org-unit-form";

const TYPE = "Department" as const;
const BASE_PATH = "/admin/departments";

export default async function AdminDepartmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; compose?: string; edit?: string }>;
}) {
  const { q, compose, edit } = await searchParams;
  const supabase = await createClient();

  let query = supabase.from("org_units").select("*").eq("type", TYPE);
  const term = q?.trim().replace(/[,()]/g, "");
  if (term) query = query.or(`name.ilike.%${term}%,short_code.ilike.%${term}%`);
  const { data: units } = await query.order("name");

  let panel: { mode: "new" | "edit" } | null = null;
  let initialValues = null;

  if (compose === "new") {
    panel = { mode: "new" };
  } else if (edit) {
    const { data: unit } = await supabase
      .from("org_units")
      .select("*")
      .eq("id", edit)
      .eq("type", TYPE)
      .maybeSingle();
    if (unit) {
      panel = { mode: "edit" };
      initialValues = unit;
    }
  }

  return (
    <div className="py-6">
      <PageHeader
        title="Department Management"
        description="Manage the departments used across the portal."
        action={
          <Link
            href={`${BASE_PATH}?compose=new`}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Add New
          </Link>
        }
      />

      <form
        method="get"
        className="mb-6 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by Name or Short Code..."
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
        />
        <button
          type="submit"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Search
        </button>
        {q && (
          <Link href={BASE_PATH} className="text-sm text-slate-500 hover:text-slate-700">
            Clear
          </Link>
        )}
      </form>

      <OrgUnitTable type={TYPE} basePath={BASE_PATH} units={units ?? []} />

      {panel && (
        // key forces a fresh mount on every real navigation that shows this panel — see
        // components/use-dismissable.ts's header comment for why this is required.
        <OrgUnitFormPanel
          key={Date.now()}
          type={TYPE}
          basePath={BASE_PATH}
          mode={panel.mode}
          initialValues={initialValues}
        />
      )}
    </div>
  );
}
