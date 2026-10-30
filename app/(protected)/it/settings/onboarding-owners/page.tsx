import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { checked, hasItPermission } from "@/lib/it/ticket-data";
import { TASK_TYPE_LABELS } from "@/lib/it/onboarding";
import type { ItChecklistTaskType } from "@/types/database";
import { addTaskTypeOwner, removeTaskTypeOwner, setPrimaryTaskTypeOwner } from "./actions";
import { cardClass, FormMessage, secondaryButtonClass } from "../../_components/ticket-ui";

const smallSelect =
  "rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-blue-500";

const TASK_TYPES = Object.keys(TASK_TYPE_LABELS) as ItChecklistTaskType[];

// Task-type owners — same idea as /it/settings/owners (ticket category owners) applied to
// onboarding checklist task types instead: when a task of that type is created, it auto-assigns
// to the ★ primary owner. Flat, no site dimension — onboarding tasks aren't site-routed.
export default async function TaskTypeOwnersPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const [canEdit, { data: owners }, { data: staff }] = await Promise.all([
    hasItPermission(supabase, "it.onboarding.assign"),
    supabase.schema("it").rpc("list_task_type_owners").then(checked),
    supabase.schema("it").rpc("list_onboarding_staff").then(checked),
  ]);

  const ownersOf = (taskType: ItChecklistTaskType) => (owners ?? []).filter((o) => o.task_type === taskType);

  function ownerRow(taskType: ItChecklistTaskType) {
    const rowOwners = ownersOf(taskType);
    const available = (staff ?? []).filter((s) => !rowOwners.some((o) => o.person_id === s.person_id));
    const label = TASK_TYPE_LABELS[taskType];
    return (
      <li key={taskType} className="flex flex-wrap items-center gap-2 py-2">
        <span className="w-64 shrink-0 text-sm font-medium text-slate-900">{label}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {rowOwners.length === 0 && (
            <span className="text-xs text-slate-400">No owner — stays unassigned until picked up</span>
          )}
          {rowOwners.map((o) => (
            <span
              key={o.person_id}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700"
            >
              {o.is_primary && <span aria-label="Primary owner">★</span>}
              {o.full_name}
              {canEdit && !o.is_primary && (
                <form action={setPrimaryTaskTypeOwner.bind(null, taskType, o.person_id)} className="inline">
                  <button type="submit" title="Make primary" className="ml-1 text-slate-400 hover:text-amber-600">
                    ☆
                  </button>
                </form>
              )}
              {canEdit && (
                <form action={removeTaskTypeOwner.bind(null, taskType, o.person_id)} className="inline">
                  <button
                    type="submit"
                    aria-label={`Remove ${o.full_name}`}
                    className="ml-1 text-slate-400 hover:text-red-600"
                  >
                    ×
                  </button>
                </form>
              )}
            </span>
          ))}
        </div>
        {canEdit && available.length > 0 && (
          <form action={addTaskTypeOwner.bind(null, taskType)} className="flex items-center gap-2">
            <select name="personId" defaultValue="" required aria-label={`Add owner for ${label}`} className={smallSelect}>
              <option value="" disabled>
                Add owner…
              </option>
              {available.map((s) => (
                <option key={s.person_id} value={s.person_id}>
                  {s.full_name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-slate-600">
              <input type="checkbox" name="primary" defaultChecked={!rowOwners.some((o) => o.is_primary)} />
              ★ primary
            </label>
            <button type="submit" className="text-sm font-medium text-blue-700 hover:underline">
              Add
            </button>
          </form>
        )}
      </li>
    );
  }

  return (
    <div className="py-6">
      <PageHeader
        title="Onboarding Task Owners"
        description="Who a new checklist task auto-assigns to, by task type. ★ = primary owner."
        action={
          <Link href="/it/settings/owners" className={secondaryButtonClass}>
            Category Owners
          </Link>
        }
      />
      <FormMessage error={params.error} notice={params.notice} />
      {!canEdit && <StatusPill label="View only" tone="neutral" />}

      <section className={`${cardClass} mt-4 px-6 py-2`}>
        <ul className="divide-y divide-slate-100">{TASK_TYPES.map((t) => ownerRow(t))}</ul>
      </section>
    </div>
  );
}
