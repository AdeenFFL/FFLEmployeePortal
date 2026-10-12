import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { RolePermissionsEditor } from "@/components/role-permissions-editor";
import { saveHrRolePermissions } from "./actions";
import type { Permission } from "@/types/database";

// HR's own fine-grained access config, kept out of the cross-module /admin/roles screen on
// purpose — see that page's MODULE_OWNED_PREFIXES note. module:hr itself (whether a role can
// open the HR module at all) is still configured there, not here; this page covers what a role
// can actually *do* once inside — real per-operation (create/read/update/delete) permissions,
// not one blanket "manage" toggle. Section label shown on this page, keyed by key prefix.
const HR_PERMISSION_SECTIONS: { label: string; keys: string[] }[] = [
  { label: "Tickets", keys: ["hr.tickets.read", "hr.tickets.update", "hr.tickets.delete"] },
  {
    label: "Ticket Categories",
    keys: ["hr.categories.create", "hr.categories.update", "hr.categories.delete"],
  },
  {
    label: "Anonymous Feedback",
    keys: ["hr.anonymous_feedback.read", "hr.anonymous_feedback.update"],
  },
  { label: "Administration", keys: ["hr.manage_role_permissions"] },
];
const ALL_HR_PERMISSION_KEYS = HR_PERMISSION_SECTIONS.flatMap((s) => s.keys);

export default async function HrRolesAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { role: roleParam } = await searchParams;
  const supabase = await createClient();

  const { data: roles } = await supabase.from("roles").select("*").order("name");
  const selectedRoleId = roleParam ?? roles?.[0]?.id;
  const selectedRole = (roles ?? []).find((r) => r.id === selectedRoleId);

  const { data: permissions } = await supabase
    .from("permissions")
    .select("*")
    .eq("module", "hr")
    .in("key", ALL_HR_PERMISSION_KEYS);
  const permissionByKey = new Map((permissions ?? []).map((p) => [p.key, p]));

  const { data: grants } = selectedRoleId
    ? await supabase
        .from("role_permissions")
        .select("permission_id")
        .eq("role_id", selectedRoleId)
    : { data: [] };
  const grantedIds = (grants ?? []).map((g) => g.permission_id);

  if (permissionByKey.size < ALL_HR_PERMISSION_KEYS.length) {
    return (
      <div className="py-6">
        <PageHeader title="HR Role Permissions" />
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-400">
          HR's permissions haven't been fully seeded yet
          (supabase/migrations/0017_hr_crud_permissions.sql). Run that migration first.
        </p>
      </div>
    );
  }

  const permissionsBySection: [string, Permission[]][] = HR_PERMISSION_SECTIONS.map((section) => [
    section.label,
    section.keys.map((key) => permissionByKey.get(key)!),
  ]);

  return (
    <div className="py-6">
      <PageHeader
        title="HR Role Permissions"
        description="Configure what each portal role can do inside the HR module."
      />

      <div className="flex gap-6">
        <div className="w-56 shrink-0 space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
          {(roles ?? []).map((r) => (
            <Link
              key={r.id}
              href={`/hr/admin/roles?role=${r.id}`}
              className={`block rounded-xl px-4 py-3 text-sm font-semibold ${
                r.id === selectedRoleId
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-800 hover:bg-slate-50"
              }`}
            >
              {r.name}
            </Link>
          ))}
        </div>

        <div className="flex-1">
          {selectedRole && (
            <div className="mb-4">
              <h2 className="text-base font-semibold text-slate-900">
                {selectedRole.name} — HR Permissions
              </h2>
            </div>
          )}

          {selectedRoleId && (
            <RolePermissionsEditor
              key={selectedRoleId}
              roleId={selectedRoleId}
              moduleAccessPermissions={[]}
              permissionsBySection={permissionsBySection}
              initialGrantedIds={grantedIds}
              grantMetaBySection={{}}
              saveAction={saveHrRolePermissions}
            />
          )}
        </div>
      </div>
    </div>
  );
}
