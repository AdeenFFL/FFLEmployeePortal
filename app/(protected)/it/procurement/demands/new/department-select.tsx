"use client";

import Link from "next/link";
import { useState } from "react";

// Department picker that says where the demand goes next: the department's approvers, or a
// warning that it will wait until one is added (javaria_it_0019 then sends it automatically).
export function DepartmentSelect({
  departments,
  approvers,
  inputClass,
  labelClass,
  canManageApprovers,
}: {
  departments: { id: string; name: string }[];
  approvers: Record<string, string[]>;
  inputClass: string;
  labelClass: string;
  canManageApprovers: boolean;
}) {
  const [departmentId, setDepartmentId] = useState("");
  const names = approvers[departmentId] ?? [];

  return (
    <div className="block">
      <label className="block">
        <span className={labelClass}>
          Department <span className="text-red-500">*</span>
        </span>
        <select
          name="departmentId"
          required
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          className={inputClass}
        >
          <option value="" disabled>
            Choose…
          </option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      {departmentId &&
        (names.length > 0 ? (
          <p className="mt-1 text-xs text-emerald-700">Goes to {names.join(", ")} for approval.</p>
        ) : (
          <p className="mt-1 text-xs text-amber-700">
            No approver for this department yet — the demand waits until one is added.
            {canManageApprovers && (
              <>
                {" "}
                <Link href="/it/procurement/settings/approvers" className="font-medium underline">
                  Add approver
                </Link>
              </>
            )}
          </p>
        ))}
    </div>
  );
}
