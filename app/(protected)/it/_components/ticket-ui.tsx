import { StatusPill } from "@/components/status-pill";
import {
  formatBytes,
  formatDateTime,
  PRIORITY_TONE,
  SLA_LABEL,
  slaState,
  STATUS_TONE,
} from "@/lib/it/tickets";
import type { ItTicket, ItTicketUpdate } from "@/types/database";

// Presentational pieces shared by the employee (/it/my-tickets) and IT staff (/it/tickets)
// ticket screens. Server components only — no client state here.

export const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500";
export const labelClass = "mb-1 block text-sm font-medium text-slate-700";
export const primaryButtonClass =
  "rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700";
export const secondaryButtonClass =
  "rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50";
export const cardClass = "rounded-xl border border-slate-200 bg-white shadow-sm";

export function StatusBadge({ status }: { status: ItTicket["status"] }) {
  return <StatusPill label={status} tone={STATUS_TONE[status]} />;
}

export function PriorityBadge({ priority }: { priority: ItTicket["priority"] }) {
  return <StatusPill label={priority} tone={PRIORITY_TONE[priority]} />;
}

export function SlaBadge({
  ticket,
}: {
  ticket: Pick<ItTicket, "created_at" | "resolution_due_at" | "resolved_at" | "status">;
}) {
  const { label, tone } = SLA_LABEL[slaState(ticket)];
  return <StatusPill label={label} tone={tone} />;
}

// Banner for ?error= / ?notice= set by the Server Actions' redirects.
export function FormMessage({ error, notice }: { error?: string; notice?: string }) {
  if (!error && !notice) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
        error
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700"
      }`}
    >
      {error ?? notice}
    </div>
  );
}

export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{children}</dd>
    </div>
  );
}

const UPDATE_STYLE: Record<ItTicketUpdate["update_type"], string> = {
  comment: "bg-white border-slate-200",
  work_note: "bg-amber-50 border-amber-200",
  status_change: "bg-slate-50 border-slate-200",
  assignment: "bg-slate-50 border-slate-200",
  priority_change: "bg-slate-50 border-slate-200",
  escalation: "bg-red-50 border-red-200",
  system: "bg-slate-50 border-slate-200",
};

export function Timeline({
  updates,
  names,
}: {
  updates: ItTicketUpdate[];
  names: Map<string, string>;
}) {
  if (updates.length === 0) {
    return <p className="py-4 text-center text-sm text-slate-400">No updates yet.</p>;
  }

  return (
    <ol className="space-y-3">
      {updates.map((u) => {
        const isEvent = u.update_type !== "comment" && u.update_type !== "work_note";
        const author = u.author_person_id
          ? (names.get(u.author_person_id) ?? "IT Team")
          : "System";
        return (
          <li key={u.id} className={`rounded-lg border px-4 py-3 ${UPDATE_STYLE[u.update_type]}`}>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-700">{author}</span>
              <span>·</span>
              <span>{formatDateTime(u.created_at)}</span>
              {u.update_type === "work_note" && (
                <StatusPill label="Internal note" tone="warning" />
              )}
            </div>
            <p
              className={`whitespace-pre-wrap text-sm ${
                isEvent ? "italic text-slate-600" : "text-slate-800"
              }`}
            >
              {u.body}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

export function AttachmentList({
  attachments,
  urls,
}: {
  attachments: { id: string; storage_path: string; file_name: string; size_bytes: number | null }[];
  urls: Map<string, string>;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul className="space-y-1">
      {attachments.map((a) => {
        const url = urls.get(a.storage_path);
        return (
          <li key={a.id} className="text-sm">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-blue-700 hover:underline"
              >
                {a.file_name}
              </a>
            ) : (
              <span className="text-slate-700">{a.file_name}</span>
            )}
            <span className="ml-2 text-xs text-slate-400">{formatBytes(a.size_bytes)}</span>
          </li>
        );
      })}
    </ul>
  );
}
