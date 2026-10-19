import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { RolePermissionsEditor } from "@/components/role-permissions-editor";
import { saveItRolePermissions, type ItRolesErrorCode } from "./actions";
import type { Permission } from "@/types/database";

// Sections by key prefix, in display order. Not a hand-written key list (unlike
// hr/admin/roles): every permission with module = 'it' and an "it." key appears automatically,
// and anything that matches no prefix lands in "Other".
const SECTIONS: { label: string; prefixes: string[] }[] = [
  { label: "Assets", prefixes: ["it.assets."] },
  { label: "Repairs", prefixes: ["it.maintenance."] },
  { label: "Stock", prefixes: ["it.stock."] },
  { label: "Valuation", prefixes: ["it.valuation."] },
  { label: "Inventory settings", prefixes: ["it.inventory_settings."] },
  { label: "Tickets", prefixes: ["it.tickets.", "it.ticket_settings."] },
  { label: "Onboarding", prefixes: ["it.onboarding."] },
  { label: "Administration", prefixes: ["it.manage_role_permissions"] },
];
const OTHER = "Other";

// Fixed messages for the fixed codes actions.ts redirects with. The URL never carries text;
// an unknown code shows nothing.
const ERROR_MESSAGES: Record<ItRolesErrorCode, string> = {
  "db-refused":
    "The database did not allow this change. Only an Admin with full access can change role permissions. Nothing was saved — please ask an Admin to make this change.",
  partial:
    "Only some of your changes were saved — the database did not allow the rest. Only an Admin with full access can reliably change role permissions; please ask an Admin to finish the change.",
  "last-holder":
    "At least one role must keep “IT Role Permissions”, otherwise nobody could open this page. Nothing was saved.",
  "bad-key": "This page can only change IT permissions. Nothing was saved.",
};

function sectionFor(key: string) {
  return SECTIONS.find((s) => s.prefixes.some((p) => key.startsWith(p)))?.label ?? OTHER;
}

// IT's own role-permission screen (07-it-inventory-plan.md §2.1, shared by both IT tracks). Edits
// existing roles only — roles are created and renamed on /admin/roles. module:it (whether a role
// can open the IT module at all) is also configured there, not here.
export default async function ItRolesAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; error?: string; t?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  // The proxy already checks this for /it/admin/roles; checked again so the page never renders
  // for someone without it.
  const { data: canManage } = await supabase.rpc("has_permission", {
    p_permission_key: "it.manage_role_permissions",
  });
  if (!canManage) redirect("/unauthorized");

  const [{ data: roles }, { data: permissionRows }] = await Promise.all([
    supabase.from("roles").select("*").order("name"),
    supabase.from("permissions").select("*").eq("module", "it").like("key", "it.%").order("key"),
  ]);
  const selectedRole =
    (roles ?? []).find((r) => r.id === params.role) ?? (roles ?? [])[0] ?? null;

  // Group by prefix; keep SECTIONS order, empty sections hidden, "Other" last.
  const bySection = new Map<string, Permission[]>();
  for (const permission of permissionRows ?? []) {
    const label = sectionFor(permission.key);
    if (!bySection.has(label)) bySection.set(label, []);
    bySection.get(label)!.push(permission);
  }
  const permissionsBySection: [string, Permission[]][] = [...SECTIONS.map((s) => s.label), OTHER]
    .filter((label) => bySection.has(label))
    .map((label) => [label, bySection.get(label)!]);

  // Always the real state from the database — after a refused save, this is what the editor
  // restarts from, so it never shows a change that didn't happen.
  const { data: grants } = selectedRole
    ? await supabase.from("role_permissions").select("permission_id").eq("role_id", selectedRole.id)
    : { data: [] };
  const grantedIds = (grants ?? []).map((g) => g.permission_id);

  // Own keys only, so a crafted ?error=constructor (or any unknown code) shows nothing.
  const errorCode =
    params.error && Object.hasOwn(ERROR_MESSAGES, params.error)
      ? (params.error as ItRolesErrorCode)
      : undefined;
  const errorMessage = errorCode ? ERROR_MESSAGES[errorCode] : undefined;
  // For "partial": what this role really holds now, re-read from the database (not the URL).
  const grantedNow =
    errorCode === "partial"
      ? (permissionRows ?? []).filter((p) => grantedIds.includes(p.id)).map((p) => p.label)
      : [];

  // Remount the editor whenever a save came back (t changes on every redirect), so its toggles
  // restart from grantedIds instead of keeping what the user tried to save.
  const nonce = /^\d+$/.test(params.t ?? "") ? params.t : "";

  return (
    <div className="py-6">
      <PageHeader
        title="IT Role Permissions"
        description="Configure what each portal role can do inside the IT module. Roles are created on Roles & Permissions. If you remove IT Role Permissions from your own role, you lose access to this page."
      />

      {errorMessage && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>{errorMessage}</p>
          {errorCode === "partial" && selectedRole && (
            <p className="mt-2">
              {selectedRole.name} now really has:{" "}
              {grantedNow.length > 0 ? grantedNow.join(", ") : "no IT permissions"}. The switches
              below show exactly what is saved.
            </p>
          )}
        </div>
      )}

      {(roles ?? []).length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-400">
          No roles found.
        </p>
      ) : (
        <div className="flex gap-6">
          <div className="w-56 shrink-0 space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
            {(roles ?? []).map((r) => (
              <Link
                key={r.id}
                href={`/it/admin/roles?role=${r.id}`}
                className={`block rounded-xl px-4 py-3 text-sm font-semibold ${
                  r.id === selectedRole?.id
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
              <>
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-slate-900">
                    {selectedRole.name} — IT Permissions
                  </h2>
                </div>
                <RolePermissionsEditor
                  key={`${selectedRole.id}-${nonce}`}
                  roleId={selectedRole.id}
                  moduleAccessPermissions={[]}
                  permissionsBySection={permissionsBySection}
                  initialGrantedIds={grantedIds}
                  grantMetaBySection={{}}
                  saveAction={saveItRolePermissions}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
