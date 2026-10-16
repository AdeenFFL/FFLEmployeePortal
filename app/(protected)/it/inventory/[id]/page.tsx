import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { fetchOrgUnits, fetchPersonNames, hasItPermission } from "@/lib/it/ticket-data";
import { formatDateTime } from "@/lib/it/tickets";
import {
  cardClass,
  Fact,
  FormMessage,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  StatusBadge,
} from "../../_components/ticket-ui";
import { assignAsset, changeAssetStatus, deleteAsset, returnAsset } from "../actions";
import {
  ASSET_STATUS_TONES,
  formatDate,
  MANUAL_STATUSES,
  RETURN_STATUSES,
  SYSTEM_MANAGED_STATUSES,
} from "../asset-status";
import { DeleteAssetButton } from "./delete-asset-button";
import { PersonPicker } from "./person-picker";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={`${cardClass} p-5`}>
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

// INV-03 — one asset. Overview, assignment history (+ assign / return panels) and linked tickets;
// the maintenance, movements, valuation and origin sections arrive with Phases 4–7
// (07-it-inventory-plan.md §4).
export default async function AssetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const [{ id }, { notice, error }] = await Promise.all([params, searchParams]);
  const supabase = await createClient();

  const { data: asset } = await supabase
    .schema("it")
    .from("assets")
    .select("*, asset_types(name, classification)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!asset) notFound();

  const [
    { data: company },
    orgUnits,
    personNames,
    canUpdate,
    canDelete,
    canReadTickets,
    canAssign,
  ] = await Promise.all([
    supabase.from("companies").select("name").eq("id", asset.company_id).maybeSingle(),
    fetchOrgUnits(supabase),
    fetchPersonNames(supabase, [asset.created_by, asset.updated_by]),
    hasItPermission(supabase, "it.assets.update"),
    hasItPermission(supabase, "it.assets.delete"),
    hasItPermission(supabase, "it.tickets.read"),
    hasItPermission(supabase, "it.assets.assign"),
  ]);

  // Assignment history, newest first (rows are never overwritten — a return only fills in the
  // return columns). The open row, if any, feeds the Return panel.
  const { data: assignmentRows, error: historyError } = await supabase
    .schema("it")
    .from("asset_assignments")
    .select(
      "id, person_id, assigned_by_person_id, returned_to_person_id, assigned_date, return_date, assigned_condition, returned_condition, acknowledged_at, remarks",
    )
    .eq("asset_id", asset.id)
    .order("assigned_date", { ascending: false })
    .order("created_at", { ascending: false });
  const history = assignmentRows ?? [];
  const openAssignment = history.find((a) => a.return_date === null) ?? null;

  // Names via it.asset_person_names (talha_it_0008): any it.assets.read holder, and it has no
  // active filter, so people who have since left still show by name.
  const { data: historyPeople } = history.length
    ? await supabase.schema("it").rpc("asset_person_names", {
        p_person_ids: [
          ...new Set(
            history
              .flatMap((a) => [a.person_id, a.assigned_by_person_id, a.returned_to_person_id])
              .filter((pid): pid is string => Boolean(pid)),
          ),
        ],
      })
    : { data: null };
  const nameOf = (pid: string | null) =>
    (pid && historyPeople?.find((p) => p.person_id === pid)?.full_name) || "—";

  const showAssign = canAssign && asset.status === "Unassigned";
  const showReturn = canAssign && asset.status === "In Use" && openAssignment !== null;

  // Only shown to the IT queue: without it.tickets.read, RLS would return just the viewer's own
  // tickets, which would read as "this asset has no other tickets".
  const { data: tickets } = canReadTickets
    ? await supabase
        .schema("it")
        .from("tickets")
        .select("id, ticket_number, subject, status, created_at")
        .eq("linked_asset_id", asset.id)
        .order("created_at", { ascending: false })
    : { data: null };

  const isSystemManaged = SYSTEM_MANAGED_STATUSES.includes(asset.status);
  const statusChoices = MANUAL_STATUSES.filter((s) => s !== asset.status);

  return (
    <div className="py-6">
      <Link href="/it/inventory" className="mb-3 inline-block text-sm text-blue-600 hover:underline">
        ← Asset Register
      </Link>
      <PageHeader
        title={asset.asset_tag}
        description={asset.asset_name}
        action={
          canUpdate || canDelete ? (
            <div className="flex gap-2">
              {canUpdate && (
                <Link href={`/it/inventory/${asset.id}/edit`} className={secondaryButtonClass}>
                  Edit
                </Link>
              )}
              {canDelete && !isSystemManaged && (
                <form action={deleteAsset.bind(null, asset.id)}>
                  <DeleteAssetButton assetTag={asset.asset_tag} />
                </form>
              )}
            </div>
          ) : undefined
        }
      />

      <FormMessage error={error} notice={notice} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Overview">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Fact label="Status">
                <StatusPill label={asset.status} tone={ASSET_STATUS_TONES[asset.status]} />
              </Fact>
              <Fact label="Type">
                {asset.asset_types
                  ? `${asset.asset_types.name} (${asset.asset_types.classification})`
                  : "—"}
              </Fact>
              <Fact label="Serial number">
                <span className="font-mono text-xs">{asset.serial_number}</span>
              </Fact>
              <Fact label="Manufacturer / model">
                {[asset.manufacturer, asset.model_number].filter(Boolean).join(" · ") || "—"}
              </Fact>
              <Fact label="Company">{company?.name ?? "—"}</Fact>
              <Fact label="Site">
                {(asset.site_id && orgUnits.nameById.get(asset.site_id)) ?? "—"}
              </Fact>
              <Fact label="Condition">{asset.condition ?? "—"}</Fact>
              <Fact label="Purchase date">{formatDate(asset.purchase_date)}</Fact>
              <Fact label="Warranty expiry">{formatDate(asset.warranty_expiry)}</Fact>
            </dl>
            {asset.notes && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Notes</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{asset.notes}</p>
              </div>
            )}
          </Panel>

          <Panel title="Assignment history">
            {historyError ? (
              <p className="text-sm text-red-600">
                Couldn&apos;t load the assignment history: {historyError.message}
              </p>
            ) : history.length === 0 ? (
              <p className="text-sm text-slate-400">This asset has never been assigned.</p>
            ) : (
              <div className="-mx-5 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-2">Holder</th>
                      <th className="px-3 py-2">Assigned</th>
                      <th className="px-3 py-2">Returned</th>
                      <th className="px-3 py-2">Condition</th>
                      <th className="px-3 py-2">Acknowledged</th>
                      <th className="px-5 py-2">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 align-top">
                    {history.map((a) => (
                      <tr key={a.id}>
                        <td className="px-5 py-2 font-medium text-slate-900">{nameOf(a.person_id)}</td>
                        <td className="px-3 py-2 text-slate-700">
                          {formatDate(a.assigned_date)}
                          <span className="block text-xs text-slate-500">
                            by {nameOf(a.assigned_by_person_id)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {a.return_date ? (
                            <>
                              {formatDate(a.return_date)}
                              <span className="block text-xs text-slate-500">
                                to {nameOf(a.returned_to_person_id)}
                              </span>
                            </>
                          ) : (
                            <StatusPill label="Current" tone="positive" />
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-700">
                          <span className="block">Out: {a.assigned_condition ?? "—"}</span>
                          {a.return_date && (
                            <span className="block">Back: {a.returned_condition ?? "—"}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {a.acknowledged_at ? formatDateTime(a.acknowledged_at) : "—"}
                        </td>
                        <td className="px-5 py-2 text-slate-700">{a.remarks ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {canReadTickets && (
            <Panel title="Linked tickets">
              {(tickets ?? []).length === 0 ? (
                <p className="text-sm text-slate-400">No tickets reference this asset.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {(tickets ?? []).map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                      <Link href={`/it/tickets/${t.id}`} className="min-w-0 hover:underline">
                        <span className="font-mono text-xs text-slate-500">{t.ticket_number}</span>{" "}
                        <span className="text-sm text-slate-900">{t.subject}</span>
                      </Link>
                      <StatusBadge status={t.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>

        <div className="space-y-6">
          {showAssign && (
            <Panel title="Assign asset">
              <form action={assignAsset.bind(null, asset.id)} className="space-y-3">
                <div>
                  <label className={labelClass}>Employee *</label>
                  <PersonPicker name="person_id" />
                </div>
                <div>
                  {/* Left empty = today, decided by the database (no server-timezone guess). */}
                  <label className={labelClass}>Assigned date (leave empty for today)</label>
                  <input type="date" name="assigned_date" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Condition at handover</label>
                  <input
                    name="condition"
                    defaultValue={asset.condition ?? ""}
                    placeholder="e.g. New, Good"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Remarks</label>
                  <input name="remarks" placeholder="Optional" className={inputClass} />
                </div>
                <button type="submit" className={primaryButtonClass}>
                  Assign asset
                </button>
              </form>
            </Panel>
          )}

          {showReturn && openAssignment && (
            <Panel title="Return asset">
              <p className="mb-3 text-sm text-slate-500">
                Held by{" "}
                <span className="font-medium text-slate-900">{nameOf(openAssignment.person_id)}</span>{" "}
                since {formatDate(openAssignment.assigned_date)}
                {openAssignment.assigned_condition
                  ? ` (condition at handover: ${openAssignment.assigned_condition})`
                  : ""}
                .
              </p>
              <form action={returnAsset.bind(null, asset.id)} className="space-y-3">
                <div>
                  {/* Left empty = today, decided by the database (no server-timezone guess). */}
                  <label className={labelClass}>Return date (leave empty for today)</label>
                  <input
                    type="date"
                    name="return_date"
                    min={openAssignment.assigned_date}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Condition on return</label>
                  <input
                    name="returned_condition"
                    placeholder="e.g. Good, screen scratched"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Remarks</label>
                  <input name="remarks" placeholder="Optional" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>After the return, the asset is</label>
                  <select name="new_status" defaultValue="Unassigned" className={inputClass}>
                    {RETURN_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className={primaryButtonClass}>
                  Record return
                </button>
              </form>
            </Panel>
          )}

          {canUpdate && (
            <Panel title="Change status">
              {isSystemManaged ? (
                <p className="text-sm text-slate-500">
                  {asset.status === "In Use"
                    ? "This asset is assigned. Record a return to change its status."
                    : "This asset is in repair. Close the repair record to change its status."}
                </p>
              ) : (
                <form action={changeAssetStatus.bind(null, asset.id)} className="space-y-3">
                  <div>
                    <label className={labelClass}>New status</label>
                    <select name="status" required defaultValue="" className={inputClass}>
                      <option value="" disabled>
                        Select a status
                      </option>
                      {statusChoices.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Reason</label>
                    <input name="reason" placeholder="Optional" className={inputClass} />
                  </div>
                  <button type="submit" className={primaryButtonClass}>
                    Update status
                  </button>
                </form>
              )}
            </Panel>
          )}

          <Panel title="Record">
            <dl className="space-y-3">
              <Fact label="Registered">
                {formatDateTime(asset.created_at)}
                {asset.created_by && personNames.get(asset.created_by)
                  ? ` by ${personNames.get(asset.created_by)}`
                  : ""}
              </Fact>
              <Fact label="Last updated">
                {formatDateTime(asset.updated_at)}
                {asset.updated_by && personNames.get(asset.updated_by)
                  ? ` by ${personNames.get(asset.updated_by)}`
                  : ""}
              </Fact>
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
