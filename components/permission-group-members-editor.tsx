import { OptimisticToggle } from "@/components/optimistic-toggle";
import {
  togglePermissionInGroup,
  addPermissionToGroup,
} from "@/app/(protected)/admin/permission-groups/actions";

export function PermissionGroupMembersEditor({
  groupId,
  modulePermissions,
  initialMemberIds,
}: {
  groupId: string;
  modulePermissions: { id: string; key: string; description: string | null }[];
  initialMemberIds: string[];
}) {
  const memberSet = new Set(initialMemberIds);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Permissions in this module
        </h3>
        {modulePermissions.length === 0 ? (
          <p className="text-sm text-slate-400">
            No permissions exist in this module yet — add one below.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {modulePermissions.map((permission) => {
              const included = memberSet.has(permission.id);
              return (
                <div key={permission.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {permission.description ?? permission.key}
                    </p>
                    <p className="text-xs text-slate-400">{permission.key}</p>
                  </div>
                  <OptimisticToggle
                    pressed={included}
                    label={permission.description ?? permission.key}
                    action={togglePermissionInGroup.bind(null, groupId, permission.id, !included)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Add a New Permission
        </h3>
        <form
          action={addPermissionToGroup.bind(null, groupId)}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Key</span>
            <input
              name="key"
              required
              placeholder="e.g. hse.report_incident"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Description</span>
            <input
              name="description"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </label>
          <button
            type="submit"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Add &amp; Include in Group
          </button>
        </form>
      </div>
    </div>
  );
}
