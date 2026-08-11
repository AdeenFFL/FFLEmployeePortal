import Link from "next/link";
import { setOrgUnitStatus } from "@/lib/admin/org-units";
import { StatusPill } from "@/components/status-pill";
import { ToggleSwitch } from "@/components/toggle-switch";
import { BuildingIcon, MapPinIcon } from "@/components/icons";
import type { OrgUnit, OrgUnitType } from "@/types/database";

export function OrgUnitTable({
  type,
  basePath,
  units,
}: {
  type: OrgUnitType;
  basePath: string;
  units: OrgUnit[];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3">{type === "Department" ? "Department" : "Site"} Name</th>
            <th className="px-4 py-3">Short Code</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {units.map((unit) => (
            <tr key={unit.id}>
              <td className="px-4 py-3">
                <p className="font-medium text-slate-800">{unit.name}</p>
                {unit.description && (
                  <p className="text-xs text-slate-500">{unit.description}</p>
                )}
              </td>
              <td className="px-4 py-3 text-slate-500">{unit.short_code ?? "—"}</td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center gap-1.5">
                  {unit.type === "Department" ? (
                    <BuildingIcon className="h-3.5 w-3.5 text-slate-400" />
                  ) : (
                    <MapPinIcon className="h-3.5 w-3.5 text-slate-400" />
                  )}
                  <StatusPill
                    label={unit.type === "Department" ? "Dept" : "Site"}
                    tone="neutral"
                  />
                </span>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <form action={setOrgUnitStatus.bind(null, type, unit.id, !unit.is_active)}>
                    <ToggleSwitch pressed={unit.is_active} label={`${unit.name} active status`} />
                  </form>
                  <span className="text-xs text-slate-500">
                    {unit.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`${basePath}?edit=${unit.id}`}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Edit
                </Link>
              </td>
            </tr>
          ))}
          {units.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                No {type === "Department" ? "departments" : "sites"} found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
