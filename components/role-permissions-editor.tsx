"use client";

import { useState, useTransition } from "react";
import { ToggleSwitch } from "@/components/toggle-switch";
import { saveRolePermissionGroups } from "@/app/(protected)/admin/roles/actions";
import type { PermissionGroup } from "@/types/database";

type GrantMeta = { grantedByName: string | null; grantedAt: string | null };

export function RolePermissionsEditor({
  roleId,
  moduleAccessGroups,
  groupsByModule,
  initialGrantedIds,
  grantMetaByModule,
}: {
  roleId: string;
  moduleAccessGroups: PermissionGroup[];
  groupsByModule: [string, PermissionGroup[]][];
  initialGrantedIds: string[];
  grantMetaByModule: Record<string, GrantMeta | null>;
}) {
  const [granted, setGranted] = useState(new Set(initialGrantedIds));
  const [committed, setCommitted] = useState(new Set(initialGrantedIds));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isDirty =
    granted.size !== committed.size || [...granted].some((id) => !committed.has(id));

  function toggle(id: string) {
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleReset() {
    setGranted(new Set(committed));
    setError(null);
  }

  function handleSave() {
    setError(null);
    const allGroups = [...moduleAccessGroups, ...groupsByModule.flatMap(([, groups]) => groups)];
    const changes = allGroups
      .filter((g) => granted.has(g.id) !== committed.has(g.id))
      .map((g) => ({ permissionGroupId: g.id, granted: granted.has(g.id) }));
    if (changes.length === 0) return;

    startTransition(async () => {
      try {
        await saveRolePermissionGroups(roleId, changes);
        setCommitted(new Set(granted));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save changes.");
      }
    });
  }

  return (
    <div className="space-y-6">
      {moduleAccessGroups.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-blue-700">
            Module Access
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Whether this role can open each module at all. Fine-grained permissions within a
            module (who can manage its tickets, categories, etc.) are configured from that
            module's own settings screen, not here.
          </p>
          <div className="divide-y divide-blue-100">
            {moduleAccessGroups.map((group) => (
              <div key={group.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{group.description ?? group.name}</p>
                </div>
                <ToggleSwitch
                  type="button"
                  pressed={granted.has(group.id)}
                  label={group.name}
                  onClick={() => toggle(group.id)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {groupsByModule.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-400">
          No permission groups exist yet.{" "}
          <a href="/admin/permission-groups" className="text-blue-600 hover:underline">
            Create one
          </a>{" "}
          before you can grant anything to a role.
        </p>
      )}

      {groupsByModule.map(([moduleName, groups]) => {
        const meta = grantMetaByModule[moduleName];
        return (
          <div
            key={moduleName}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                {moduleName}
              </h2>
              {meta && (
                <p className="whitespace-nowrap text-xs text-slate-400">
                  Last updated by {meta.grantedByName ?? "System default"} on{" "}
                  {meta.grantedAt ? new Date(meta.grantedAt).toLocaleDateString() : "—"}
                </p>
              )}
            </div>
            <div className="divide-y divide-slate-100">
              {groups.map((group) => (
                <div key={group.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{group.name}</p>
                    {group.description && (
                      <p className="text-xs text-slate-400">{group.description}</p>
                    )}
                  </div>
                  <ToggleSwitch
                    type="button"
                    pressed={granted.has(group.id)}
                    label={group.name}
                    onClick={() => toggle(group.id)}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={handleReset}
          disabled={!isDirty || isPending}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
