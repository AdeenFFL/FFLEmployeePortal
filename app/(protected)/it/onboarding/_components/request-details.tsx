import { StatusPill } from "@/components/status-pill";
import { KIND_TONE, LIFECYCLE_STATUS_TONE, type DetailField } from "@/lib/it/onboarding";
import { formatDate } from "@/lib/it/tickets";
import type { ItLifecycleRequest } from "@/types/database";
import { cardClass, Fact, PriorityBadge } from "../../_components/ticket-ui";

type TaskResponse = { id: string; label: string; recorded: DetailField[]; details: Record<string, string> };

// The request as HR raised it. Shared by the IT page (/it/onboarding/[id]) and HR's read-only
// view (/hr/onboarding/[id]) — taskResponses is IT-only (undefined on the HR view), promoting
// each completed task's structured response fields up into this summary instead of leaving them
// only visible under the task itself (Unified Ticket/Task Tracker, Phase 2).
export function RequestDetails({
  request,
  nameById,
  taskResponses,
}: {
  request: ItLifecycleRequest;
  nameById: Map<string, string>;
  taskResponses?: TaskResponse[];
}) {
  const orgUnits = { nameById };
  return (
    <section className={`${cardClass} p-6`}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusPill label={request.kind} tone={KIND_TONE[request.kind]} />
        <StatusPill label={request.status} tone={LIFECYCLE_STATUS_TONE[request.status]} />
        <PriorityBadge priority={request.priority} />
        <StatusPill label={request.routing_team} tone="neutral" />
      </div>
      <dl className="grid gap-4 sm:grid-cols-3">
        <Fact label="Employee">
          {request.employee_name}
          {request.employee_code && ` (${request.employee_code})`}
        </Fact>
        <Fact label="Designation">{request.designation ?? "—"}</Fact>
        {request.grade && <Fact label="Grade">{request.grade}</Fact>}
        <Fact label="Department">
          {(request.department_id && orgUnits.nameById.get(request.department_id)) ?? "—"}
        </Fact>
        <Fact label="Location">
          {(request.site_id && orgUnits.nameById.get(request.site_id)) ?? "—"}
        </Fact>
        <Fact label="Reporting manager">{request.reporting_manager_name ?? "—"}</Fact>
        {request.employee_category && (
          <Fact label="Category">{request.employee_category}</Fact>
        )}
        {request.joining_date && (
          <Fact label="Joining date">{formatDate(request.joining_date)}</Fact>
        )}
        {request.last_working_date && (
          <Fact label="Last working date">{formatDate(request.last_working_date)}</Fact>
        )}
        <Fact label="Due">{formatDate(request.due_date)}</Fact>
        {request.personal_email && (
          <Fact label="Personal email">{request.personal_email}</Fact>
        )}
        {request.kind === "Onboarding" && (
          <>
            <Fact label="Email required">{request.email_required ? "Yes" : "No"}</Fact>
            <Fact label="Laptop required">{request.laptop_required ? "Yes" : "No"}</Fact>
          </>
        )}
        {(taskResponses ?? []).map((t) => (
          <Fact key={t.id} label={t.label}>
            {t.recorded.map((f) => `${f.label}: ${t.details[f.key]}`).join(" · ")}
          </Fact>
        ))}
      </dl>
      {(request.access_required ||
        request.software_required ||
        request.known_assets_accesses ||
        request.remarks) && (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 text-sm">
          {request.access_required && (
            <p>
              <span className="font-medium text-slate-600">Access required: </span>
              {request.access_required}
            </p>
          )}
          {request.software_required && (
            <p>
              <span className="font-medium text-slate-600">Software: </span>
              {request.software_required}
            </p>
          )}
          {request.known_assets_accesses && (
            <p>
              <span className="font-medium text-slate-600">Known assets / accesses: </span>
              {request.known_assets_accesses}
            </p>
          )}
          {request.remarks && (
            <p>
              <span className="font-medium text-slate-600">Remarks: </span>
              {request.remarks}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
