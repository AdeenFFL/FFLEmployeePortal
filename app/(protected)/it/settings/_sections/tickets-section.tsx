import { OptimisticToggle } from "@/components/optimistic-toggle";
import { AutoSaveField } from "@/components/auto-save-field";
import { AddRowForm } from "@/components/add-row-form";
import { OwnerChips, type OwnerCandidate, type OwnerChip } from "@/components/owner-chips";
import { StatusPill } from "@/components/status-pill";
import { PRIORITY_TONE, TICKET_PRIORITIES } from "@/lib/it/tickets";
import type { ItRequestType, ItSlaPolicy, ItTicketCategory } from "@/types/database";
import {
  addCategoryOwner,
  createCategory,
  createRequestType,
  removeCategoryOwner,
  setCategoryActive,
  setCategoryNeedsAccessField,
  setPrimaryCategoryOwner,
  setRequestTypeActive,
  updateCategoryName,
  updateCategorySortOrder,
  updateRequestTypeDescription,
  updateRequestTypeName,
  updateSlaField,
} from "../actions";
import { cardClass, inputClass, labelClass, primaryButtonClass } from "../../_components/ticket-ui";

const smallInput =
  "rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

type CategoryOwnerRow = OwnerChip & { categoryId: string };

function CategoryRow({
  category,
  indent,
  siteId,
  canEditOwners,
  siteStaff,
  ownersOf,
}: {
  category: ItTicketCategory;
  indent?: boolean;
  siteId: string | undefined;
  canEditOwners: boolean;
  siteStaff: OwnerCandidate[];
  ownersOf: (categoryId: string) => OwnerChip[];
}) {
  return (
    <li className={`flex flex-wrap items-center gap-3 py-2.5 ${indent ? "pl-6" : ""}`}>
      <AutoSaveField
        defaultValue={category.name}
        label="Name"
        className={`${smallInput} w-48 ${indent ? "" : "font-medium"}`}
        action={updateCategoryName.bind(null, category.id)}
      />
      <AutoSaveField
        defaultValue={String(category.sort_order)}
        label="Sort order"
        type="number"
        className={`${smallInput} w-16`}
        action={updateCategorySortOrder.bind(null, category.id)}
      />
      <OptimisticToggle
        pressed={category.needs_access_field}
        label="Show Access field"
        statusLabels={{ on: "Access field shown", off: "Access field hidden" }}
        action={setCategoryNeedsAccessField.bind(null, category.id, !category.needs_access_field)}
      />
      <OptimisticToggle
        pressed={category.is_active}
        label="Active"
        statusLabels={{ on: "Active", off: "Inactive" }}
        action={setCategoryActive.bind(null, category.id, !category.is_active)}
      />
      {siteId && (
        <OwnerChips
          owners={ownersOf(category.id)}
          available={siteStaff}
          canEdit={canEditOwners}
          onAdd={addCategoryOwner.bind(null, siteId, category.id)}
          onRemove={removeCategoryOwner.bind(null, siteId, category.id)}
          onSetPrimary={setPrimaryCategoryOwner.bind(null, siteId, category.id)}
        />
      )}
    </li>
  );
}

export function TicketsSection({
  section,
  slas,
  requestTypes,
  categories,
  canEdit,
  siteId,
  siteName,
  canEditOwners,
  siteStaff,
  categoryOwners,
}: {
  section: "sla" | "types" | "categories";
  slas: ItSlaPolicy[];
  requestTypes: ItRequestType[];
  categories: ItTicketCategory[];
  canEdit: boolean;
  siteId: string | undefined;
  siteName: string | undefined;
  canEditOwners: boolean;
  siteStaff: OwnerCandidate[];
  categoryOwners: CategoryOwnerRow[];
}) {
  const slaByPriority = new Map(slas.map((s) => [s.priority, s]));
  const topLevel = categories.filter((c) => !c.parent_id);
  const childrenOf = (id: string) => categories.filter((c) => c.parent_id === id);
  const ownersByCategory = new Map<string, OwnerChip[]>();
  for (const o of categoryOwners) {
    ownersByCategory.set(o.categoryId, [...(ownersByCategory.get(o.categoryId) ?? []), o]);
  }
  const ownersOf = (categoryId: string) => ownersByCategory.get(categoryId) ?? [];

  if (section === "sla") {
    return (
      <section className={`${cardClass} overflow-hidden`}>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 text-xs text-slate-400">
            <tr>
              <th className="px-5 py-3 font-medium">Priority</th>
              <th className="px-4 py-3 font-medium">First response</th>
              <th className="px-4 py-3 font-medium">Resolution</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {TICKET_PRIORITIES.map((priority) => {
              const sla = slaByPriority.get(priority);
              return (
                <tr key={priority}>
                  <td className="px-5 py-3">
                    <StatusPill label={priority} tone={PRIORITY_TONE[priority]} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <AutoSaveField
                        type="number"
                        label={`${priority} first response hours`}
                        defaultValue={String(sla?.response_hours ?? "")}
                        className={`${smallInput} w-24`}
                        action={updateSlaField.bind(null, priority, "response")}
                      />
                      <span className="text-xs text-slate-400">hours</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <AutoSaveField
                        type="number"
                        label={`${priority} resolution hours`}
                        defaultValue={String(sla?.resolution_hours ?? "")}
                        className={`${smallInput} w-24`}
                        action={updateSlaField.bind(null, priority, "resolution")}
                      />
                      <span className="text-xs text-slate-400">hours</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-amber-600">{!sla && "Not set: no due date"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
          Counted around the clock from submission. Saves as you type; applies to tickets raised or
          re-prioritised after that.
        </p>
      </section>
    );
  }

  if (section === "types") {
    const kinds = ["Ticket", "Onboarding", "Offboarding", "Replacement"] as const;
    return (
      <section className={`${cardClass} p-5`}>
        <p className="mb-3 text-xs text-slate-500">
          Ticket types appear on the Raise IT Ticket form. For Onboarding / Offboarding / Replacement,
          the first active one of each is used.
        </p>
        <div className="space-y-4">
          {kinds
            .filter((k) => requestTypes.some((t) => t.applies_to === k))
            .map((k) => (
              <div key={k}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">{k}</h3>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 px-3">
                  {requestTypes
                    .filter((t) => t.applies_to === k)
                    .map((t) => (
                      <li key={t.id} className="flex flex-wrap items-center gap-3 py-2">
                        <AutoSaveField
                          defaultValue={t.name}
                          label="Name"
                          className={`${smallInput} w-48 font-medium`}
                          action={updateRequestTypeName.bind(null, t.id)}
                        />
                        <AutoSaveField
                          defaultValue={t.description ?? ""}
                          label="Description"
                          placeholder="Description (optional)"
                          className={`${smallInput} min-w-0 flex-1`}
                          action={updateRequestTypeDescription.bind(null, t.id)}
                        />
                        <OptimisticToggle
                          pressed={t.is_active}
                          label={`${t.name} active`}
                          action={setRequestTypeActive.bind(null, t.id, !t.is_active)}
                        />
                      </li>
                    ))}
                </ul>
              </div>
            ))}
        </div>
        {canEdit && (
          <AddRowForm
            action={createRequestType}
            submitLabel="Add"
            submitClassName={primaryButtonClass}
            className="mt-5 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4"
          >
            <label>
              <span className={labelClass}>For</span>
              <select name="appliesTo" defaultValue="Ticket" className={inputClass}>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-48">
              <span className={labelClass}>New request type</span>
              <input name="name" required placeholder="Name" className={inputClass} />
            </label>
            <label className="min-w-48 flex-1">
              <span className={labelClass}>Description</span>
              <input name="description" placeholder="Optional" className={inputClass} />
            </label>
          </AddRowForm>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        A new ticket goes to the ★ owner of its subcategory (else its category) at the ticket&apos;s site
        {siteName ? ` (owners shown for ${siteName})` : ""}. Lower sort order shows first.
      </p>
      {topLevel.map((category) => {
        const subs = childrenOf(category.id);
        const ownerCount = [category, ...subs].reduce((n, c) => n + ownersOf(c.id).length, 0);
        return (
          <details key={category.id} className={`${cardClass} group overflow-hidden`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 hover:bg-slate-50">
              <span className="flex items-center gap-2">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                  className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-90"
                >
                  <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className={`text-sm font-semibold ${category.is_active ? "text-slate-900" : "text-slate-400"}`}>
                  {category.name}
                </span>
                {!category.is_active && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">Inactive</span>
                )}
              </span>
              <span className="text-xs text-slate-400">
                {subs.length} subcategor{subs.length === 1 ? "y" : "ies"} · {ownerCount} owner
                {ownerCount === 1 ? "" : "s"}
              </span>
            </summary>
            <div className="border-t border-slate-100 px-5">
              <ul className="divide-y divide-slate-100">
                <CategoryRow
                  category={category}
                  siteId={siteId}
                  canEditOwners={canEditOwners}
                  siteStaff={siteStaff}
                  ownersOf={ownersOf}
                />
                {subs.map((sub) => (
                  <CategoryRow
                    key={sub.id}
                    category={sub}
                    indent
                    siteId={siteId}
                    canEditOwners={canEditOwners}
                    siteStaff={siteStaff}
                    ownersOf={ownersOf}
                  />
                ))}
              </ul>
              {canEdit && (
                <AddRowForm
                  action={createCategory}
                  submitLabel="Add"
                  submitClassName="text-sm font-medium text-blue-700 hover:underline"
                  className="flex flex-wrap items-center gap-2 border-t border-slate-100 py-2.5 pl-6"
                >
                  <input type="hidden" name="parentId" value={category.id} />
                  <input
                    name="name"
                    required
                    placeholder={`New subcategory under ${category.name}`}
                    aria-label={`New subcategory under ${category.name}`}
                    className={`${smallInput} min-w-0 flex-1`}
                  />
                </AddRowForm>
              )}
            </div>
          </details>
        );
      })}
      {canEdit && (
        <AddRowForm
          action={createCategory}
          submitLabel="Add category"
          submitClassName={primaryButtonClass}
          className={`${cardClass} flex flex-wrap items-end gap-3 p-4`}
        >
          <label className="min-w-48 flex-1">
            <span className={labelClass}>New category</span>
            <input name="name" required placeholder="e.g. Printers" className={inputClass} />
          </label>
          <label className="w-28">
            <span className={labelClass}>Sort order</span>
            <input name="sortOrder" type="number" defaultValue={100} className={inputClass} />
          </label>
        </AddRowForm>
      )}
    </div>
  );
}
