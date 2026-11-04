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
  "rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-blue-500";

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

  return (
    <div className="space-y-6">
      <section className={`${cardClass} p-6`}>
        <h2 className="text-base font-semibold text-slate-900">SLA targets</h2>
        <p className="mb-4 text-sm text-slate-500">
          Hours from submission, counted around the clock. Saves as you edit — applies to tickets
          raised (or re-prioritised) after that; existing tickets keep their due dates.
        </p>
        <div className="space-y-3">
          {TICKET_PRIORITIES.map((priority) => {
            const sla = slaByPriority.get(priority);
            return (
              <div
                key={priority}
                className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-100 p-3"
              >
                <div className="w-24 pb-2">
                  <StatusPill label={priority} tone={PRIORITY_TONE[priority]} />
                </div>
                <label>
                  <span className="mb-1 block text-xs text-slate-500">First response (hours)</span>
                  <AutoSaveField
                    type="number"
                    label="First response hours"
                    defaultValue={String(sla?.response_hours ?? "")}
                    className={`${smallInput} w-32`}
                    action={updateSlaField.bind(null, priority, "response")}
                  />
                </label>
                <label>
                  <span className="mb-1 block text-xs text-slate-500">Resolution (hours)</span>
                  <AutoSaveField
                    type="number"
                    label="Resolution hours"
                    defaultValue={String(sla?.resolution_hours ?? "")}
                    className={`${smallInput} w-32`}
                    action={updateSlaField.bind(null, priority, "resolution")}
                  />
                </label>
                {!sla && (
                  <span className="pb-2 text-xs text-amber-600">
                    Not set — tickets of this priority get no due date.
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className={`${cardClass} p-6`}>
        <h2 className="text-base font-semibold text-slate-900">Request types</h2>
        <p className="mb-4 text-sm text-slate-500">
          Ticket types appear on the Raise IT Ticket form. Onboarding / Offboarding / Replacement
          types are used for HR&apos;s requests (the first active one of each kind).
        </p>
        <ul className="divide-y divide-slate-100">
          {requestTypes.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400">
                {t.applies_to}
              </span>
              <AutoSaveField
                defaultValue={t.name}
                label="Name"
                className={`${smallInput} w-40 font-medium`}
                action={updateRequestTypeName.bind(null, t.id)}
              />
              <AutoSaveField
                defaultValue={t.description ?? ""}
                label="Description"
                placeholder="Description"
                className={`${smallInput} min-w-0 flex-1`}
                action={updateRequestTypeDescription.bind(null, t.id)}
              />
              <OptimisticToggle
                pressed={t.is_active}
                label="Active"
                statusLabels={{ on: "Active", off: "Inactive" }}
                action={setRequestTypeActive.bind(null, t.id, !t.is_active)}
              />
            </li>
          ))}
        </ul>
        {canEdit && (
          <AddRowForm
            action={createRequestType}
            submitLabel="Add request type"
            submitClassName={`${primaryButtonClass} md:col-span-4`}
            className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-4"
          >
            <label>
              <span className={labelClass}>Applies to</span>
              <select name="appliesTo" defaultValue="Ticket" className={inputClass}>
                <option value="Ticket">Ticket</option>
                <option value="Onboarding">Onboarding</option>
                <option value="Offboarding">Offboarding</option>
                <option value="Replacement">Replacement</option>
              </select>
            </label>
            <label>
              <span className={labelClass}>Name</span>
              <input name="name" required className={inputClass} />
            </label>
            <label className="md:col-span-2">
              <span className={labelClass}>Description</span>
              <input name="description" className={inputClass} />
            </label>
          </AddRowForm>
        )}
      </section>

      <section className={`${cardClass} p-6`}>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">Categories &amp; subcategories</h2>
          {siteId && <span className="text-xs text-slate-400">Owners shown for {siteName}</span>}
        </div>
        <p className="mb-4 text-sm text-slate-500">
          Lower sort order shows first. A new ticket auto-assigns to the ★ owner of its
          subcategory (else its category) at the handling site.
        </p>
        <div className="space-y-4">
          {topLevel.map((category) => (
            <div key={category.id} className="rounded-lg border border-slate-200 px-4">
              <ul className="divide-y divide-slate-100">
                <CategoryRow
                  category={category}
                  siteId={siteId}
                  canEditOwners={canEditOwners}
                  siteStaff={siteStaff}
                  ownersOf={ownersOf}
                />
                {childrenOf(category.id).map((sub) => (
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
                  className="flex flex-wrap items-center gap-2 border-t border-slate-100 py-2 pl-6"
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
          ))}
        </div>
        {canEdit && (
          <AddRowForm
            action={createCategory}
            submitLabel="Add category"
            submitClassName={primaryButtonClass}
            className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-4"
          >
            <label className="md:col-span-2">
              <span className={labelClass}>New category</span>
              <input name="name" required className={inputClass} />
            </label>
            <label>
              <span className={labelClass}>Sort order</span>
              <input name="sortOrder" type="number" defaultValue={100} className={inputClass} />
            </label>
          </AddRowForm>
        )}
      </section>
    </div>
  );
}
