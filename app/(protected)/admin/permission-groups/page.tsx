import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { PermissionGroupFormPanel } from "@/components/permission-group-form";
import { PermissionGroupMembersEditor } from "@/components/permission-group-members-editor";
import { IconLink, IconButton } from "@/components/icon-button";
import { PencilIcon, TrashIcon } from "@/components/icons";
import { deletePermissionGroup } from "./actions";
import type { PermissionGroup } from "@/types/database";

export default async function AdminPermissionGroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; compose?: string; editGroup?: string }>;
}) {
  const { group: groupParam, compose, editGroup } = await searchParams;
  const supabase = await createClient();

  const { data: groups } = await supabase
    .from("permission_groups")
    .select("*")
    .order("module")
    .order("name");

  const selectedGroupId = groupParam ?? groups?.[0]?.id;
  const selectedGroup = (groups ?? []).find((g) => g.id === selectedGroupId);
  const groupBeingEdited = editGroup ? (groups ?? []).find((g) => g.id === editGroup) : undefined;

  const groupsByModule = new Map<string, PermissionGroup[]>();
  for (const group of groups ?? []) {
    if (!groupsByModule.has(group.module)) groupsByModule.set(group.module, []);
    groupsByModule.get(group.module)!.push(group);
  }

  let modulePermissions: { id: string; key: string; description: string | null }[] = [];
  let memberPermissionIds: string[] = [];
  if (selectedGroup) {
    const { data: perms } = await supabase
      .from("permissions")
      .select("id, key, description")
      .eq("module", selectedGroup.module)
      .order("key");
    modulePermissions = perms ?? [];

    const { data: members } = await supabase
      .from("permission_group_permissions")
      .select("permission_id")
      .eq("permission_group_id", selectedGroup.id);
    memberPermissionIds = (members ?? []).map((m) => m.permission_id);
  }

  return (
    <div className="py-6">
      <PageHeader
        title="Permission Groups"
        description="Module-scoped bundles of permissions. Roles are composed of these groups, not raw permissions directly."
        action={
          <Link
            href="/admin/permission-groups?compose=new"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + New Group
          </Link>
        }
      />

      <div className="flex gap-6">
        <div className="w-64 shrink-0 space-y-4">
          {[...groupsByModule.entries()].map(([moduleName, moduleGroups]) => (
            <div key={moduleName}>
              <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {moduleName}
              </p>
              <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                {moduleGroups.map((g) => {
                  const active = g.id === selectedGroupId;
                  return (
                    <div key={g.id} className={`rounded-lg ${active ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                      <Link href={`/admin/permission-groups?group=${g.id}`} className="block px-3 pt-2">
                        <p className={`text-sm font-medium ${active ? "text-blue-700" : "text-slate-800"}`}>
                          {g.name}
                        </p>
                      </Link>
                      <div className="flex items-center gap-1 px-2 pb-1.5 pt-1">
                        <IconLink
                          href={`/admin/permission-groups?group=${selectedGroupId}&editGroup=${g.id}`}
                          icon={<PencilIcon className="h-4 w-4" />}
                          label="Rename group"
                        />
                        <form action={deletePermissionGroup.bind(null, g.id)}>
                          <IconButton
                            icon={<TrashIcon className="h-4 w-4" />}
                            label="Delete group"
                            tone="danger"
                          />
                        </form>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {(groups ?? []).length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-400">
              No permission groups yet.
            </p>
          )}
        </div>

        <div className="flex-1">
          {selectedGroup && (
            <>
              <div className="mb-4">
                <h2 className="text-base font-semibold text-slate-900">{selectedGroup.name}</h2>
                <p className="text-sm text-slate-500">
                  {selectedGroup.description ?? `Permissions in the '${selectedGroup.module}' module.`}
                </p>
              </div>
              <PermissionGroupMembersEditor
                key={selectedGroup.id}
                groupId={selectedGroup.id}
                modulePermissions={modulePermissions}
                initialMemberIds={memberPermissionIds}
              />
            </>
          )}

          {!selectedGroup && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-400">
              Select a permission group, or create a new one.
            </p>
          )}
        </div>
      </div>

      {compose === "new" && <PermissionGroupFormPanel mode="new" closeHref="/admin/permission-groups" />}
      {groupBeingEdited && (
        <PermissionGroupFormPanel
          mode="edit"
          closeHref={`/admin/permission-groups?group=${selectedGroupId}`}
          group={groupBeingEdited}
        />
      )}
    </div>
  );
}
