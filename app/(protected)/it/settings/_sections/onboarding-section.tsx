import { OwnerChips, type OwnerCandidate, type OwnerChip } from "@/components/owner-chips";
import { TASK_TYPE_LABELS } from "@/lib/it/onboarding";
import type { ItChecklistTaskType } from "@/types/database";
import { addTaskTypeOwner, removeTaskTypeOwner, setPrimaryTaskTypeOwner } from "../actions";
import { cardClass } from "../../_components/ticket-ui";

const TASK_TYPES = Object.keys(TASK_TYPE_LABELS) as ItChecklistTaskType[];
// Pseudo key, not a real checklist task — who the whole onboarding/offboarding/replacement
// request auto-assigns to as IT Executive on creation (it.auto_assign_lifecycle_request). Lives
// in the same it.task_type_owners table as the real task types.
const OVERALL_REQUEST_KEY = "overall_request";

type TaskOwnerRow = OwnerChip & { taskType: string };

function TaskRow({
  taskType,
  label,
  siteId,
  canEdit,
  siteStaff,
  ownersOf,
}: {
  taskType: string;
  label: string;
  siteId: string | undefined;
  canEdit: boolean;
  siteStaff: OwnerCandidate[];
  ownersOf: (taskType: string) => OwnerChip[];
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5">
      <span className="w-64 shrink-0 text-sm font-medium text-slate-900">{label}</span>
      {siteId ? (
        <OwnerChips
          owners={ownersOf(taskType)}
          available={siteStaff}
          canEdit={canEdit}
          onAdd={addTaskTypeOwner.bind(null, siteId, taskType)}
          onRemove={removeTaskTypeOwner.bind(null, siteId, taskType)}
          onSetPrimary={setPrimaryTaskTypeOwner.bind(null, siteId, taskType)}
        />
      ) : (
        <span className="text-xs text-slate-400">Pick a site above.</span>
      )}
    </li>
  );
}

export function OnboardingSection({
  siteId,
  siteName,
  canEdit,
  siteStaff,
  taskOwners,
}: {
  siteId: string | undefined;
  siteName: string | undefined;
  canEdit: boolean;
  siteStaff: OwnerCandidate[];
  taskOwners: TaskOwnerRow[];
}) {
  const ownersByTask = new Map<string, OwnerChip[]>();
  for (const o of taskOwners) {
    ownersByTask.set(o.taskType, [...(ownersByTask.get(o.taskType) ?? []), o]);
  }
  const ownersOf = (taskType: string) => ownersByTask.get(taskType) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-slate-500">
          Who a new onboarding/offboarding checklist task auto-assigns to, by task type — and who
          the whole request auto-assigns to as IT Executive. ★ = primary owner.
        </p>
        {siteId && <span className="text-xs text-slate-400">Shown for {siteName}</span>}
      </div>
      <section className={`${cardClass} px-6 py-2`}>
        <ul className="divide-y divide-slate-100">
          <TaskRow
            taskType={OVERALL_REQUEST_KEY}
            label="Overall Request (IT Executive)"
            siteId={siteId}
            canEdit={canEdit}
            siteStaff={siteStaff}
            ownersOf={ownersOf}
          />
        </ul>
      </section>
      <section className={`${cardClass} px-6 py-2`}>
        <ul className="divide-y divide-slate-100">
          {TASK_TYPES.map((t) => (
            <TaskRow
              key={t}
              taskType={t}
              label={TASK_TYPE_LABELS[t]}
              siteId={siteId}
              canEdit={canEdit}
              siteStaff={siteStaff}
              ownersOf={ownersOf}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
