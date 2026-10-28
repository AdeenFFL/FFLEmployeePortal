import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { checked } from "@/lib/it/ticket-data";
import { PRIORITY_TONE, TICKET_PRIORITIES } from "@/lib/it/tickets";
import type { ItHandledAt, ItTicketCategory } from "@/types/database";
import {
  createCategory,
  createRequestType,
  setCategoryActive,
  setCategoryHandledAt,
  setCategoryNeedsAccessField,
  setRequestTypeActive,
  setRequestTypeHandledAt,
  updateCategory,
  updateRequestType,
  updateSlaPolicy,
} from "./actions";
import {
  cardClass,
  FormMessage,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../_components/ticket-ui";

const smallInput =
  "rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-blue-500";
const linkButton = "text-sm font-medium text-blue-700 hover:underline";

function ActiveToggle({
  active,
  action,
}: {
  active: boolean;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <form action={action}>
      <button
        type="submit"
        className={active ? "text-sm text-slate-500 hover:text-red-600" : linkButton}
      >
        {active ? "Deactivate" : "Activate"}
      </button>
    </form>
  );
}

// Phase 6.1: "Handled by HQ" routes the ticket to the HQ site's IT team whatever the
// requester's site. The pill + text label carry the state (not colour alone).
function HandledAtToggle({
  handledAt,
  action,
}: {
  handledAt: ItHandledAt;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <form action={action} className="flex items-center gap-2">
      {handledAt === "hq" && <StatusPill label="Handled by HQ" tone="info" />}
      <button type="submit" className={linkButton}>
        {handledAt === "hq" ? "Handle at site" : "Handle at HQ"}
      </button>
    </form>
  );
}

function CategoryRow({ category, indent }: { category: ItTicketCategory; indent?: boolean }) {
  return (
    <li className={`flex flex-wrap items-center gap-2 py-2 ${indent ? "pl-6" : ""}`}>
      <form
        action={updateCategory.bind(null, category.id)}
        className="flex flex-1 flex-wrap items-center gap-2"
      >
        <input
          name="name"
          defaultValue={category.name}
          required
          aria-label="Name"
          className={`${smallInput} min-w-0 flex-1 ${indent ? "" : "font-medium"}`}
        />
        <input
          name="sortOrder"
          type="number"
          defaultValue={category.sort_order}
          aria-label="Sort order"
          title="Sort order"
          className={`${smallInput} w-20`}
        />
        <button type="submit" className={linkButton}>
          Save
        </button>
      </form>
      <HandledAtToggle
        handledAt={category.handled_at}
        action={setCategoryHandledAt.bind(
          null,
          category.id,
          category.handled_at === "hq" ? "site" : "hq",
        )}
      />
      <form
        action={setCategoryNeedsAccessField.bind(null, category.id, !category.needs_access_field)}
        className="flex items-center gap-2"
      >
        {category.needs_access_field && <StatusPill label="Shows Access field" tone="info" />}
        <button type="submit" className={linkButton}>
          {category.needs_access_field ? "Hide access field" : "Show access field"}
        </button>
      </form>
      {!category.is_active && <StatusPill label="Inactive" tone="neutral" />}
      <ActiveToggle
        active={category.is_active}
        action={setCategoryActive.bind(null, category.id, !category.is_active)}
      />
    </li>
  );
}

// ITSM-01 — Ticket Settings (plan 08 Phase 2): SLA targets, request types, categories.
// Gated by it.ticket_settings.update in lib/auth/route-permissions.ts.
export default async function TicketSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const supabase = await createClient();

  const [{ data: slas }, { data: requestTypes }, { data: categories }] = await Promise.all([
    supabase.schema("it").from("sla_policies").select("*").then(checked),
    supabase
      .schema("it")
      .from("request_types")
      .select("*")
      .order("applies_to")
      .order("name")
      .then(checked),
    supabase
      .schema("it")
      .from("ticket_categories")
      .select("*")
      .order("sort_order")
      .order("name")
      .then(checked),
  ]);

  const slaByPriority = new Map((slas ?? []).map((s) => [s.priority, s]));
  const topLevel = (categories ?? []).filter((c) => !c.parent_id);
  const childrenOf = (id: string) => (categories ?? []).filter((c) => c.parent_id === id);

  return (
    <div className="py-6">
      <PageHeader
        title="Ticket Settings"
        description="SLA targets, request types and categories used by IT tickets and onboarding."
        action={
          <Link href="/it/settings/sites" className={secondaryButtonClass}>
            Sites &amp; IT staff
          </Link>
        }
      />
      <FormMessage error={error} notice={notice} />

      <div className="space-y-6">
        {/* SLA targets */}
        <section className={`${cardClass} p-6`}>
          <h2 className="text-base font-semibold text-slate-900">SLA targets</h2>
          <p className="mb-4 text-sm text-slate-500">
            Hours from submission, counted around the clock. Changes apply to tickets raised
            (or re-prioritised) after you save; existing tickets keep their due dates.
          </p>
          <div className="space-y-3">
            {TICKET_PRIORITIES.map((priority) => {
              const sla = slaByPriority.get(priority);
              return (
                <form
                  key={priority}
                  action={updateSlaPolicy.bind(null, priority)}
                  className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-100 p-3"
                >
                  <div className="w-24 pb-2">
                    <StatusPill label={priority} tone={PRIORITY_TONE[priority]} />
                  </div>
                  <label>
                    <span className="mb-1 block text-xs text-slate-500">First response (hours)</span>
                    <input
                      name="responseHours"
                      type="number"
                      min="0.25"
                      step="0.25"
                      required
                      defaultValue={sla?.response_hours ?? ""}
                      className={`${smallInput} w-32`}
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs text-slate-500">Resolution (hours)</span>
                    <input
                      name="resolutionHours"
                      type="number"
                      min="0.25"
                      step="0.25"
                      required
                      defaultValue={sla?.resolution_hours ?? ""}
                      className={`${smallInput} w-32`}
                    />
                  </label>
                  <button type="submit" className={secondaryButtonClass}>
                    Save
                  </button>
                  {!sla && (
                    <span className="pb-2 text-xs text-amber-600">
                      Not set — tickets of this priority get no due date.
                    </span>
                  )}
                </form>
              );
            })}
          </div>
        </section>

        {/* Request types */}
        <section className={`${cardClass} p-6`}>
          <h2 className="text-base font-semibold text-slate-900">Request types</h2>
          <p className="mb-4 text-sm text-slate-500">
            Ticket types appear on the Raise IT Ticket form. Onboarding / Offboarding / Replacement
            types are used for HR&apos;s requests (the first active one of each kind).
            Deactivate instead of deleting: old tickets still use them.
          </p>
          <ul className="divide-y divide-slate-100">
            {(requestTypes ?? []).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="w-28 text-xs font-medium uppercase tracking-wide text-slate-400">
                  {t.applies_to}
                </span>
                <form
                  action={updateRequestType.bind(null, t.id)}
                  className="flex flex-1 flex-wrap items-center gap-2"
                >
                  <input
                    name="name"
                    defaultValue={t.name}
                    required
                    aria-label="Name"
                    className={`${smallInput} w-48 font-medium`}
                  />
                  <input
                    name="description"
                    defaultValue={t.description ?? ""}
                    placeholder="Description"
                    aria-label="Description"
                    className={`${smallInput} min-w-0 flex-1`}
                  />
                  <button type="submit" className={linkButton}>
                    Save
                  </button>
                </form>
                {t.applies_to === "Ticket" && (
                  <HandledAtToggle
                    handledAt={t.handled_at}
                    action={setRequestTypeHandledAt.bind(
                      null,
                      t.id,
                      t.handled_at === "hq" ? "site" : "hq",
                    )}
                  />
                )}
                {!t.is_active && <StatusPill label="Inactive" tone="neutral" />}
                <ActiveToggle
                  active={t.is_active}
                  action={setRequestTypeActive.bind(null, t.id, !t.is_active)}
                />
              </li>
            ))}
          </ul>
          <form
            action={createRequestType}
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
            <div className="md:col-span-4">
              <button type="submit" className={primaryButtonClass}>
                Add request type
              </button>
            </div>
          </form>
        </section>

        {/* Categories */}
        <section className={`${cardClass} p-6`}>
          <h2 className="text-base font-semibold text-slate-900">Categories &amp; subcategories</h2>
          <p className="mb-4 text-sm text-slate-500">
            Lower sort order shows first. Deactivated entries disappear from the ticket form but
            stay on existing tickets.
          </p>
          <div className="space-y-4">
            {topLevel.map((category) => (
              <div key={category.id} className="rounded-lg border border-slate-200 px-4">
                <ul className="divide-y divide-slate-100">
                  <CategoryRow category={category} />
                  {childrenOf(category.id).map((sub) => (
                    <CategoryRow key={sub.id} category={sub} indent />
                  ))}
                </ul>
                <form
                  action={createCategory}
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
                  <button type="submit" className={linkButton}>
                    Add
                  </button>
                </form>
              </div>
            ))}
          </div>
          <form
            action={createCategory}
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
            <div className="flex items-end">
              <button type="submit" className={primaryButtonClass}>
                Add category
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
