import { setOrgUnitStatus } from "@/lib/admin/org-units";
import { StatusPill } from "@/components/status-pill";
import { OptimisticToggle } from "@/components/optimistic-toggle";
import { IconLink } from "@/components/icon-button";
import { BuildingIcon, MapPinIcon, PencilIcon } from "@/components/icons";
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
                <OptimisticToggle
                  pressed={unit.is_active}
                  label={`${unit.name} active status`}
                  action={setOrgUnitStatus.bind(null, type, unit.id, !unit.is_active)}
                  statusLabels={{ on: "Active", off: "Inactive" }}
                />
              </td>
              <td className="px-4 py-3">
                <IconLink
                  href={`${basePath}?edit=${unit.id}`}
                  icon={<PencilIcon className="h-4 w-4" />}
                  label={`Edit ${unit.name}`}
                  tone="primary"
                />
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
