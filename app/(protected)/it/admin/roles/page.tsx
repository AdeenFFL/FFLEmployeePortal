import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { RolePermissionsEditor } from "@/components/role-permissions-editor";
import { checked, fetchPersonNames } from "@/lib/it/ticket-data";
import type { Permission } from "@/types/database";
import { createItRole, saveItRolePermissions, setItRoleTag } from "./actions";
import {
  cardClass,
  FormMessage,
  inputClass,
  labelClass,
  primaryButtonClass,
} from "../../_components/ticket-ui";

// IT Roles & Permissions — the IT module's own access screen. Shows and changes ONLY IT
// permissions (module = 'it'); everything else about roles (who holds them, non-IT permissions)
// stays on Administration. Gated by it.manage_role_permissions (route + every write).

// Group IT permissions by what they control (sections merged from Talha's version of this
// screen, 2026-10-20). Unknown future keys fall into "Other IT".
const SECTIONS: { label: string; prefixes: string[] }[] = [
  { label: "Tickets", prefixes: ["it.tickets.", "it.ticket_settings."] },
  { label: "Onboarding / Offboarding", prefixes: ["it.onboarding."] },
  { label: "Assets", prefixes: ["it.assets."] },
  { label: "Repairs", prefixes: ["it.maintenance."] },
  { label: "Stock", prefixes: ["it.stock."] },
  { label: "Valuation", prefixes: ["it.valuation."] },
  { label: "Inventory settings", prefixes: ["it.inventory_settings."] },
  { label: "Administration", prefixes: ["it.manage_role_permissions"] },
];

export default async function ItRolesPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; notice?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: roles }, { data: itRoleRows }, { data: permissions }] = await Promise.all([
    supabase.from("roles").select("id, name, description").order("name").then(checked),
    supabase.schema("it").from("it_roles").select("role_id").then(checked),
    // Only "it.*" keys: module:it (whether a role can open IT at all) is an Admin decision made
    // on Administration → Roles (develop's 0021, Talha's design) — not changeable here.
    supabase
      .from("permissions")
      .select("*")
      .eq("module", "it")
      .like("key", "it.%")
      .order("key")
      .then(checked),
  ]);

  const itRoleIds = new Set((itRoleRows ?? []).map((r) => r.role_id));
  const itRoles = (roles ?? []).filter((r) => itRoleIds.has(r.id));
  const otherRoles = (roles ?? []).filter((r) => !itRoleIds.has(r.id));
  const selected =
    (roles ?? []).find((r) => r.id === params.role) ?? itRoles[0] ?? (roles ?? [])[0] ?? null;

  const itPermissions = (permissions ?? []) as Permission[];
  const sections: [string, Permission[]][] = [];
  for (const section of SECTIONS) {
    const inSection = itPermissions.filter((p) => section.prefixes.some((prefix) => p.key.startsWith(prefix)));
    if (inSection.length) sections.push([section.label, inSection]);
  }
  const placed = new Set(sections.flatMap(([, ps]) => ps.map((p) => p.id)));
  const leftover = itPermissions.filter((p) => !placed.has(p.id));
  if (leftover.length) sections.push(["Other IT", leftover]);

  // Current IT grants for the selected role, plus "last updated by" per section.
  const { data: grants } = selected
    ? await supabase
        .from("role_permissions")
        .select("permission_id, granted_by, granted_at")
        .eq("role_id", selected.id)
        .in(
          "permission_id",
          itPermissions.map((p) => p.id),
        )
    : { data: [] as { permission_id: string; granted_by: string | null; granted_at: string }[] };

  const names = await fetchPersonNames(supabase, (grants ?? []).map((g) => g.granted_by));
  const grantMetaBySection: Record<string, { grantedByName: string | null; grantedAt: string | null } | null> = {};
  for (const [label, ps] of sections) {
    const ids = new Set(ps.map((p) => p.id));
    const latest = (grants ?? [])
      .filter((g) => ids.has(g.permission_id))
      .sort((a, b) => b.granted_at.localeCompare(a.granted_at))[0];
    grantMetaBySection[label] = latest
      ? { grantedByName: latest.granted_by ? (names.get(latest.granted_by) ?? null) : null, grantedAt: latest.granted_at }
      : null;
  }

  function roleLink(role: { id: string; name: string }) {
    const active = selected?.id === role.id;
    return (
      <li key={role.id}>
        <Link
          href={`/it/admin/roles?role=${role.id}`}
          aria-current={active ? "page" : undefined}
          className={`block rounded-lg px-3 py-2 text-sm ${
            active ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700 hover:bg-slate-50"
          }`}
        >
          {role.name}
        </Link>
      </li>
    );
  }

  return (
    <div className="py-6">
      <PageHeader
        title="IT Roles & Permissions"
        description="Which roles get which IT access. Only IT permissions are shown and changed here; giving a role to a person is done on User Management."
      />
      <FormMessage error={params.error} notice={params.notice} />

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <aside className="space-y-6">
          <section className={`${cardClass} p-3`}>
            <h2 className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              IT roles
            </h2>
            {itRoles.length === 0 ? (
              <p className="px-3 pb-2 text-sm text-slate-400">None yet — create one below.</p>
            ) : (
              <ul className="space-y-0.5">{itRoles.map(roleLink)}</ul>
            )}
            <h2 className="px-3 pb-2 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Other roles
            </h2>
            <p className="px-3 pb-2 text-xs text-slate-400">
              e.g. HR needs “Raise Onboarding/Offboarding”. Opening the IT module at all
              (“IT”) is switched on under Administration → Roles.
            </p>
            <ul className="space-y-0.5">{otherRoles.map(roleLink)}</ul>
          </section>

          <section className={`${cardClass} p-4`}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">New IT role</h2>
            <form action={createItRole} className="space-y-3">
              <label className="block">
                <span className={labelClass}>Name</span>
                <input name="name" required placeholder="e.g. IT Network Engineer" className={inputClass} />
              </label>
              <label className="block">
                <span className={labelClass}>Description</span>
                <input name="description" className={inputClass} />
              </label>
              <button type="submit" className={primaryButtonClass}>
                Create IT role
              </button>
            </form>
          </section>
        </aside>

        <div>
          {selected ? (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold text-slate-900">{selected.name}</h2>
                {itRoleIds.has(selected.id) ? (
                  <StatusPill label="IT role" tone="info" />
                ) : (
                  <StatusPill label="Other role" tone="neutral" />
                )}
                <form action={setItRoleTag.bind(null, selected.id, !itRoleIds.has(selected.id))}>
                  <button type="submit" className="text-sm font-medium text-blue-700 hover:underline">
                    {itRoleIds.has(selected.id) ? "Remove from IT roles" : "Mark as IT role"}
                  </button>
                </form>
              </div>
              {selected.description && (
                <p className="mb-4 text-sm text-slate-500">{selected.description}</p>
              )}
              {/* key: remount the editor when switching roles so its local state resets. */}
              <RolePermissionsEditor
                key={selected.id}
                roleId={selected.id}
                moduleAccessPermissions={[]}
                permissionsBySection={sections}
                initialGrantedIds={(grants ?? []).map((g) => g.permission_id)}
                grantMetaBySection={grantMetaBySection}
                saveAction={saveItRolePermissions}
              />
              <p className="mt-4 text-xs text-slate-400">
                Site-level rights (which site a manager runs) are set on IT Management → Sites &amp;
                IT Staff, not here.
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-400">No roles exist yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
