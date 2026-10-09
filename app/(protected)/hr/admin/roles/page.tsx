import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { RolePermissionsEditor } from "@/components/role-permissions-editor";
import type { PermissionGroup } from "@/types/database";

// HR's own fine-grained access config, kept out of the cross-module /admin/roles screen on
// purpose — see that page's MODULE_OWNED_PREFIXES note. module:hr itself (whether a role can
// open the HR module at all) is still configured there, not here; this page only covers what a
// role can *do* once inside.
const HR_PERMISSION_KEYS = [
  "hr.manage_tickets",
  "hr.manage_anonymous_feedback",
  "hr.manage_categories",
];

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

  const { data: groups } = await supabase
    .from("permission_groups")
    .select("*, permission_group_permissions(permissions(key))")
    .eq("module", "hr");

  const hrGroups: PermissionGroup[] = (groups ?? [])
    .filter((g) =>
      g.permission_group_permissions.some((m) =>
        HR_PERMISSION_KEYS.includes(m.permissions?.key ?? ""),
      ),
    )
    .map(({ permission_group_permissions, ...rest }) => rest);

  const { data: grants } = selectedRoleId
    ? await supabase
        .from("role_permission_groups")
        .select("permission_group_id")
        .eq("role_id", selectedRoleId)
    : { data: [] };
  const grantedIds = (grants ?? []).map((g) => g.permission_group_id);

  if (hrGroups.length < HR_PERMISSION_KEYS.length) {
    return (
      <div className="py-6">
        <PageHeader title="HR Role Permissions" />
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-400">
          HR's permission groups haven't been seeded yet (supabase/migrations/0013_hr_permission_groups.sql).
          Run that migration first.
        </p>
      </div>
    );
  }

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
              moduleAccessGroups={[]}
              groupsByModule={[["HR", hrGroups]]}
              initialGrantedIds={grantedIds}
              grantMetaByModule={{}}
            />
          )}
        </div>
      </div>
    </div>
  );
}
