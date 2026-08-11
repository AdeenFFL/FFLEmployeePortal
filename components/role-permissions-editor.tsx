"use client";

import { useState, useTransition } from "react";
import { ToggleSwitch } from "@/components/toggle-switch";
import { saveRolePermissions } from "@/app/(protected)/admin/roles/actions";
import type { Permission } from "@/types/database";

type GrantMeta = { grantedByName: string | null; grantedAt: string | null };

export function RolePermissionsEditor({
  roleId,
  permissionsByModule,
  initialGrantedIds,
  grantMetaByModule,
}: {
  roleId: string;
  permissionsByModule: [string, Permission[]][];
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
    const changes = permissionsByModule
      .flatMap(([, perms]) => perms)
      .filter((p) => granted.has(p.id) !== committed.has(p.id))
      .map((p) => ({ permissionId: p.id, granted: granted.has(p.id) }));
    if (changes.length === 0) return;

    startTransition(async () => {
      try {
        await saveRolePermissions(roleId, changes);
        setCommitted(new Set(granted));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save changes.");
      }
    });
  }

  return (
    <div className="space-y-6">
      {permissionsByModule.map(([moduleName, perms]) => {
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
              {perms.map((permission) => (
                <div
                  key={permission.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {permission.description ?? permission.key}
                    </p>
                    <p className="text-xs text-slate-400">{permission.key}</p>
                  </div>
                  <ToggleSwitch
                    type="button"
                    pressed={granted.has(permission.id)}
                    label={permission.description ?? permission.key}
                    onClick={() => toggle(permission.id)}
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
