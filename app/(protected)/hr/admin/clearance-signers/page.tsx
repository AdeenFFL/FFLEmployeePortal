import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { SignerCellPanel, type CellSigner } from "./signer-panel";

type Slot = { slot_key: string; label: string; scope: "site" | "department" };
type Unit = { id: string; name: string };

const NO_INBOX_WARNING =
  "This signer has no Clearance Signer role, so they will not see the inbox.";

// Everything here comes from hr.clearance_slots plus the two security-definer lookups in
// talha_hr_0004 — persons and org_units are never read directly (HR can't, under their RLS).
export default async function ClearanceSignersPage() {
  const supabase = await createClient();
  const hr = supabase.schema("hr");

  const [slotsResult, unitsResult, signersResult, { data: canManage }] = await Promise.all([
    hr
      .from("clearance_slots")
      .select("slot_key, label, scope")
      .eq("is_active", true)
      .order("sort_order"),
    hr.rpc("clearance_list_units"),
    hr.rpc("clearance_list_signers"),
    supabase.rpc("has_permission", { p_permission_key: "hr.clearance.manage_signers" }),
  ]);

  const loadError = slotsResult.error ?? unitsResult.error ?? signersResult.error;
  if (loadError) {
    return (
      <div className="py-6">
        <div className="flex items-start gap-3">
          <Link
            href="/hr/clearance-home"
            title="Back to Clearance"
            aria-label="Back to Clearance"
            className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900"
          >
            ←
          </Link>
          <div className="min-w-0 flex-1">
            <PageHeader title="Clearance Signers" />
          </div>
        </div>
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError.message}</p>
      </div>
    );
  }

  const slots: Slot[] = slotsResult.data ?? [];
  const units = unitsResult.data ?? [];
  const signers = signersResult.data ?? [];

  // Signers who are leaving themselves (open clearance, talha_hr_0015): flagged so HR can set a
  // backup. If this lookup fails the page still shows, just without the flag.
  const { data: leavingRows } = signers.length
    ? await hr.rpc("leaving_people", {
        p_person_ids: [...new Set(signers.map((g: { person_id: string }) => g.person_id))],
      })
    : { data: [] };
  const leavingCase = new Map(
    (leavingRows ?? []).map((l) => [
      l.person_id,
      l.case_number,
    ]),
  );

  const siteSlots = slots.filter((s) => s.scope === "site");
  const deptSlots = slots.filter((s) => s.scope === "department");
  const sites: Unit[] = units.filter((u) => u.type === "Site");
  const departments: Unit[] = units.filter((u) => u.type === "Department");
  const slotLabel = new Map(slots.map((s) => [s.slot_key, s.label]));

  // One cell = one slot at one site (or department). Primary first, then by name (the lookup's order).
  const signersByCell = new Map<string, CellSigner[]>();
  const warningRows: { key: string; text: string; warnings: string[] }[] = [];
  for (const g of signers) {
    const unitId = g.site_id ?? g.department_id ?? "";
    const warnings: string[] = [];
    if (g.person_status !== "Active") {
      warnings.push(`Not an active employee (status: ${g.person_status}).`);
    }
    if (g.unit_is_active === false) {
      warnings.push(`This ${g.site_id ? "site" : "department"} is inactive.`);
    }
    if (!g.can_open_inbox) warnings.push(NO_INBOX_WARNING);
    const leaving = leavingCase.get(g.person_id);
    if (leaving) warnings.push(`Leaving: has an open clearance (${leaving}). Set a backup signer.`);

    const cellKey = `${g.slot_key}:${unitId}`;
    const cell = signersByCell.get(cellKey) ?? [];
    cell.push({
      id: g.id,
      person_id: g.person_id,
      full_name: g.full_name,
      employee_code: g.employee_code,
      designation: g.designation,
      is_primary: g.is_primary,
      warnings,
    });
    signersByCell.set(cellKey, cell);

    if (warnings.length > 0) {
      warningRows.push({
        key: g.id,
        text: `${g.full_name}: ${slotLabel.get(g.slot_key) ?? g.slot_key} at ${g.unit_name ?? "an unknown unit"}`,
        warnings,
      });
    }
  }

  const gaps: { key: string; unit: string; missing: string[] }[] = [];
  for (const site of sites) {
    const missing = siteSlots
      .filter((s) => !signersByCell.has(`${s.slot_key}:${site.id}`))
      .map((s) => s.label);
    if (missing.length > 0) gaps.push({ key: site.id, unit: site.name, missing });
  }
  for (const dept of departments) {
    const missing = deptSlots
      .filter((s) => !signersByCell.has(`${s.slot_key}:${dept.id}`))
      .map((s) => s.label);
    if (missing.length > 0) gaps.push({ key: dept.id, unit: `${dept.name} (department)`, missing });
  }

  function renderCell(slot: Slot, unit: Unit) {
    const cell = signersByCell.get(`${slot.slot_key}:${unit.id}`) ?? [];
    return (
      <td key={slot.slot_key} className="px-4 py-3 align-top">
        {cell.length === 0 ? (
          <p className="text-sm text-red-600">— none —</p>
        ) : (
          <ul className="space-y-1">
            {cell.map((s) => (
              <li key={s.id} className="text-sm text-slate-800">
                {s.is_primary && <span title="Primary">★ </span>}
                {s.full_name}
                {s.warnings.length > 0 && (
                  <span className="ml-1 text-amber-600" title={s.warnings.join(" ")}>
                    ⚠
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <SignerCellPanel
            slotKey={slot.slot_key}
            slotLabel={slot.label}
            unitId={unit.id}
            unitName={unit.name}
            signers={cell}
          />
        )}
      </td>
    );
  }

  function renderTable(title: string, unitHeader: string, rows: Unit[], columns: Slot[]) {
    return (
      <div className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">No active {unitHeader.toLowerCase()}s.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    {unitHeader}
                  </th>
                  {columns.map((slot) => (
                    <th
                      key={slot.slot_key}
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500"
                    >
                      {slot.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((unit) => (
                  <tr key={unit.id}>
                    <td className="px-4 py-3 align-top text-sm font-medium text-slate-900">
                      {unit.name}
                    </td>
                    {columns.map((slot) => renderCell(slot, unit))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="py-6">
      {/* Round back button (words in the tooltip) beside the title. */}
      <div className="flex items-start gap-3">
        <Link
          href="/hr/clearance-home"
          title="Back to Clearance"
          aria-label="Back to Clearance"
          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900"
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <PageHeader
          title="Clearance Signers"
          description="Who signs each part of the offboarding clearance forms, per site (and per department for the Department Head). ★ marks the primary signer."
          />
        </div>
      </div>

      {gaps.length === 0 && warningRows.length === 0 ? (
        <p className="mb-6 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Every site and department is fully set up.
        </p>
      ) : (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {gaps.length > 0 && (
            <>
              <p className="mb-1 font-medium">Missing signers</p>
              <ul className="mb-2 list-disc space-y-0.5 pl-5">
                {gaps.map((g) => (
                  <li key={g.key}>
                    {g.unit}: no {g.missing.join(", no ")}
                  </li>
                ))}
              </ul>
            </>
          )}
          {warningRows.length > 0 && (
            <>
              <p className="mb-1 font-medium">Signers to check</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {warningRows.map((w) => (
                  <li key={w.key}>
                    {w.text}. {w.warnings.join(" ")}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {renderTable("Sites", "Site", sites, siteSlots)}
      {deptSlots.length > 0 && renderTable("Departments", "Department", departments, deptSlots)}
    </div>
  );
}
