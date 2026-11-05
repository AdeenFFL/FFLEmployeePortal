import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/status-pill";
import { Modal } from "@/components/modal";
import { fetchAssetPersonNames, fetchOrgUnits, fetchPersonNames, hasItPermission } from "@/lib/it/ticket-data";
import { formatDateTime } from "@/lib/it/tickets";
import type { Asset } from "@/types/database";
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
import { ProductIcon, productKind } from "../../procurement/_components/product-icon";
import { AssetAssignForm } from "../_components/asset-assign-form";
import { AssetReturnForm } from "../_components/asset-return-form";
import { changeAssetStatus, closeMaintenance, deleteAsset, openMaintenance } from "../actions";
import {
  ASSET_STATUS_TONES,
  formatCost,
  formatDate,
  MANUAL_STATUSES,
  SYSTEM_MANAGED_STATUSES,
} from "../asset-status";
import { DeleteAssetButton } from "./delete-asset-button";

type AssetStatus = Asset["status"];

function Panel({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`${cardClass} p-5`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

// The asset's life, left to right. "Visited" stages come from its history, so an asset that
// has been handed out before shows In use as done even when it's back in stock.
const STAGES = ["Registered", "In stock", "In use", "In repair", "End of life"] as const;
const END_STATUSES: AssetStatus[] = ["Retired", "Disposed", "Lost"];

function stageOf(status: AssetStatus) {
  if (status === "Unassigned") return 1;
  if (status === "In Use") return 2;
  if (status === "In Repair") return 3;
  return 4;
}

type HistoryEvent = { at: string; tone: "blue" | "emerald" | "amber" | "slate"; title: string; lines: string[] };

// INV-03 — one asset: where it came from, where it is in its life, the one thing to do next,
// and everything that happened to it. Assign / return / repair / status changes still go
// through the same forms and database functions (talha_it_0004 / 0005).
export default async function AssetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    notice?: string;
    error?: string;
    assign?: string;
    return?: string;
    repair?: string;
    status?: string;
  }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { notice, error } = sp;
  const supabase = await createClient();
  const basePath = `/it/inventory/${id}`;

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
    canMaintain,
    { data: maintenanceRows, error: maintenanceError },
    { data: receipt },
    { data: vendor },
  ] = await Promise.all([
    supabase.from("companies").select("name").eq("id", asset.company_id).maybeSingle(),
    fetchOrgUnits(supabase),
    fetchPersonNames(supabase, [asset.created_by, asset.updated_by]),
    hasItPermission(supabase, "it.assets.update"),
    hasItPermission(supabase, "it.assets.delete"),
    hasItPermission(supabase, "it.tickets.read"),
    hasItPermission(supabase, "it.assets.assign"),
    hasItPermission(supabase, "it.maintenance.update"),
    // Repair history (talha_it_0005), newest first. Read-only here: changes go through
    // it.open_maintenance / it.close_maintenance.
    supabase
      .schema("it")
      .from("asset_maintenance")
      .select("id, issue_type, description, service_date, returned_date, status, resolution, cost, remarks, created_at")
      .eq("asset_id", id)
      .order("service_date", { ascending: false })
      .order("created_at", { ascending: false }),
    // Origin (javaria_it_0021). RLS may hide procurement rows from inventory-only staff; then the
    // section just shows what is on the asset itself.
    asset.receiving_id
      ? supabase
          .schema("it")
          .from("receiving_records")
          .select("receiving_number, received_date, demand_id, demands(demand_number)")
          .eq("id", asset.receiving_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    asset.vendor_id
      ? supabase.schema("it").from("vendors").select("vendor_name").eq("id", asset.vendor_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const repairs = maintenanceRows ?? [];
  const openRepair = repairs.find((r) => r.status === "Open") ?? null;

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

  const historyNames = await fetchAssetPersonNames(
    supabase,
    history.flatMap((a) => [a.person_id, a.assigned_by_person_id, a.returned_to_person_id]),
  );
  const nameOf = (pid: string | null) => (pid && historyNames.get(pid)) || "—";

  const showAssign = canAssign && asset.status === "Unassigned";
  const showReturn = canAssign && asset.status === "In Use" && openAssignment !== null;
  // it.open_maintenance refuses Retired / Disposed / Lost and already-In-Repair assets.
  const showSendForRepair = canMaintain && (asset.status === "Unassigned" || asset.status === "In Use");
  const showCloseRepair = canMaintain && asset.status === "In Repair";

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
  // ?status=1 opens the dialog; ?status=Retired (etc.) opens it with that status picked.
  const presetStatus = statusChoices.includes(sp.status as AssetStatus) ? (sp.status as AssetStatus) : "";
  const statusHref = (s?: AssetStatus) => `${basePath}?status=${s ?? "1"}`;

  const siteName = (asset.site_id && orgUnits.nameById.get(asset.site_id)) || null;
  const typeName = asset.asset_types?.name ?? "Asset";
  const current = stageOf(asset.status);
  const visited = [true, true, history.length > 0, repairs.length > 0, END_STATUSES.includes(asset.status)];
  const receiptDemand = receipt?.demands as { demand_number: string } | { demand_number: string }[] | null | undefined;
  const demandNumber = Array.isArray(receiptDemand) ? receiptDemand[0]?.demand_number : receiptDemand?.demand_number;

  // One story instead of separate tables: registration, hand-outs, returns and repairs.
  const events: HistoryEvent[] = [
    {
      at: asset.created_at,
      tone: "slate" as const,
      title: receipt ? `Registered from delivery ${receipt.receiving_number}` : "Registered",
      lines: [
        [
          asset.created_by && personNames.get(asset.created_by) ? `by ${personNames.get(asset.created_by)}` : null,
          asset.condition ? `condition ${asset.condition}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      ].filter(Boolean),
    },
    ...history.flatMap((a): HistoryEvent[] => [
      {
        at: a.assigned_date,
        tone: "emerald",
        title: `Assigned to ${nameOf(a.person_id)}`,
        lines: [
          [`by ${nameOf(a.assigned_by_person_id)}`, a.assigned_condition && `condition ${a.assigned_condition}`]
            .filter(Boolean)
            .join(" · "),
          a.acknowledged_at ? `Acknowledged ${formatDateTime(a.acknowledged_at)}` : "Not acknowledged yet",
          ...(a.remarks && !a.return_date ? [a.remarks] : []),
        ],
      },
      ...(a.return_date
        ? [
            {
              at: a.return_date,
              tone: "blue" as const,
              title: `Returned by ${nameOf(a.person_id)}`,
              lines: [
                [`to ${nameOf(a.returned_to_person_id)}`, a.returned_condition && `condition ${a.returned_condition}`]
                  .filter(Boolean)
                  .join(" · "),
                ...(a.remarks ? [a.remarks] : []),
              ],
            },
          ]
        : []),
    ]),
    ...repairs.flatMap((r): HistoryEvent[] => [
      {
        at: r.service_date,
        tone: "amber",
        title: `Sent for repair — ${r.issue_type}`,
        lines: r.description ? [r.description] : [],
      },
      ...(r.status !== "Open" && r.returned_date
        ? [
            {
              at: r.returned_date,
              tone: "blue" as const,
              title: "Back from repair",
              lines: [
                [r.resolution, r.cost !== null ? formatCost(r.cost) : null].filter(Boolean).join(" · "),
                ...(r.remarks ? [r.remarks] : []),
              ].filter(Boolean),
            },
          ]
        : []),
    ]),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <div className="py-6">
      <Link href="/it/inventory" className="mb-3 inline-block text-sm font-medium text-slate-500 hover:text-slate-800">
        ← Asset Register
      </Link>

      {/* Identity + lifecycle */}
      <section className={`${cardClass} mb-6`}>
        <div className="flex flex-wrap items-center gap-5 p-6">
          <span
            className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ${
              END_STATUSES.includes(asset.status) ? "bg-slate-100 text-slate-400" : "bg-blue-50 text-blue-600"
            }`}
          >
            <ProductIcon kind={productKind({ name: asset.asset_name, category: typeName })} className="h-8 w-8" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-bold text-slate-900">{asset.asset_tag}</h1>
              <StatusPill label={asset.status} tone={ASSET_STATUS_TONES[asset.status]} />
            </div>
            <p className="mt-0.5 text-sm text-slate-600">
              {asset.asset_name} · {typeName}
              {siteName && ` · ${siteName}`}
            </p>
            <p className="text-xs text-slate-400">Serial {asset.serial_number}</p>
          </div>
          {(canUpdate || (canDelete && !isSystemManaged)) && (
            <div className="flex gap-2">
              {canUpdate && (
                <Link href={`/it/inventory/${asset.id}/edit`} className={secondaryButtonClass}>
                  Edit details
                </Link>
              )}
              {canDelete && !isSystemManaged && (
                <form action={deleteAsset.bind(null, asset.id)}>
                  <DeleteAssetButton assetTag={asset.asset_tag} />
                </form>
              )}
            </div>
          )}
        </div>
        <ol className="flex border-t border-slate-100 px-6 py-4" aria-label="Lifecycle">
          {STAGES.map((label, i) => {
            const isCurrent = i === current;
            const done = visited[i] && !isCurrent;
            return (
              <li key={label} className="relative flex flex-1 flex-col items-center text-center">
                {i > 0 && (
                  <span
                    aria-hidden
                    className={`absolute right-1/2 top-3 h-0.5 w-full -translate-y-1/2 ${
                      visited[i] || isCurrent ? "bg-blue-200" : "bg-slate-200"
                    }`}
                  />
                )}
                <span
                  className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                    isCurrent
                      ? "bg-blue-600 text-white ring-4 ring-blue-100"
                      : done
                        ? "bg-blue-100 text-blue-700"
                        : "border border-slate-300 bg-white text-slate-400"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span
                  className={`mt-1.5 text-xs ${isCurrent ? "font-semibold text-slate-900" : done ? "text-slate-600" : "text-slate-400"}`}
                >
                  {i === 4 && END_STATUSES.includes(asset.status) ? asset.status : label}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <FormMessage error={error} notice={notice} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Details">
            <dl className="grid gap-4 sm:grid-cols-3">
              <Fact label="Manufacturer / model">
                {[asset.manufacturer, asset.model_number].filter(Boolean).join(" · ") || "—"}
              </Fact>
              <Fact label="Type">
                {asset.asset_types ? `${asset.asset_types.name} (${asset.asset_types.classification})` : "—"}
              </Fact>
              <Fact label="Condition">{asset.condition ?? "—"}</Fact>
              <Fact label="Company">{company?.name ?? "—"}</Fact>
              <Fact label="Site">{siteName ?? "—"}</Fact>
              <Fact label="Warranty until">
                {asset.warranty_expiry ? (
                  <span className={new Date(asset.warranty_expiry) < new Date() ? "text-red-700" : ""}>
                    {formatDate(asset.warranty_expiry)}
                    {new Date(asset.warranty_expiry) < new Date() && " (expired)"}
                  </span>
                ) : (
                  "—"
                )}
              </Fact>
            </dl>
            {asset.notes && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Notes</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{asset.notes}</p>
              </div>
            )}
          </Panel>

          <Panel title="Where it came from">
            <dl className="grid gap-4 sm:grid-cols-3">
              <Fact label="Vendor">{vendor?.vendor_name ?? "—"}</Fact>
              <Fact label="Purchase date">{formatDate(asset.purchase_date)}</Fact>
              <Fact label="Delivery / demand">
                {receipt ? (
                  <>
                    {receipt.receiving_number}
                    {demandNumber && (
                      <>
                        {" · "}
                        <Link
                          href={`/it/procurement/demands/${receipt.demand_id}`}
                          className="font-medium text-blue-700 hover:underline"
                        >
                          {demandNumber}
                        </Link>
                      </>
                    )}
                  </>
                ) : asset.receiving_id ? (
                  "Procurement record"
                ) : (
                  <span className="text-slate-400">Added by hand</span>
                )}
              </Fact>
            </dl>
          </Panel>

          <Panel title="History" aside={<span className="text-xs text-slate-400">Newest first</span>}>
            {historyError || maintenanceError ? (
              <p className="mb-3 text-sm text-red-600">
                Part of the history couldn&apos;t be loaded: {(historyError ?? maintenanceError)?.message}
              </p>
            ) : null}
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {events.map((e, i) => (
                <li key={i} className="relative">
                  <span
                    aria-hidden
                    className={`absolute -left-[1.6rem] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-white ${
                      { blue: "bg-blue-500", emerald: "bg-emerald-500", amber: "bg-amber-500", slate: "bg-slate-400" }[e.tone]
                    }`}
                  />
                  <p className="text-sm font-medium text-slate-900">{e.title}</p>
                  <p className="text-xs text-slate-400">{formatDate(e.at)}</p>
                  {e.lines.map((l, j) => (
                    <p key={j} className="text-xs text-slate-600">
                      {l}
                    </p>
                  ))}
                </li>
              ))}
            </ol>
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

        <aside className="space-y-6">
          {/* Next step: the one obvious action for the current stage, plus the less common ones. */}
          <section className={`${cardClass} overflow-hidden`}>
            <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Next step</p>
            </div>
            <div className="space-y-3 p-5">
              {asset.status === "Unassigned" && (
                <>
                  <p className="text-sm text-slate-600">In stock and ready to hand out.</p>
                  {showAssign && (
                    <Link href={`${basePath}?assign=1`} className={`${primaryButtonClass} block text-center`}>
                      Assign to an employee
                    </Link>
                  )}
                </>
              )}

              {asset.status === "In Use" && (
                <>
                  <p className="text-sm text-slate-600">
                    With <span className="font-medium text-slate-900">{nameOf(openAssignment?.person_id ?? null)}</span>
                    {openAssignment && ` since ${formatDate(openAssignment.assigned_date)}`}.
                  </p>
                  {showReturn && (
                    <Link href={`${basePath}?return=1`} className={`${primaryButtonClass} block text-center`}>
                      Record return
                    </Link>
                  )}
                </>
              )}

              {asset.status === "In Repair" && (
                <>
                  <p className="text-sm text-slate-600">
                    In repair since {openRepair ? formatDate(openRepair.service_date) : "—"}
                    {openRepair && (
                      <>
                        : <span className="font-medium text-slate-900">{openRepair.issue_type}</span>
                      </>
                    )}
                    .
                    {openAssignment && ` It goes back to ${nameOf(openAssignment.person_id)} when closed.`}
                  </p>
                  {showCloseRepair &&
                    (openRepair ? (
                      <Link href={`${basePath}?repair=1`} className={`${primaryButtonClass} block text-center`}>
                        Close repair
                      </Link>
                    ) : (
                      <p className="text-sm text-slate-500">
                        This asset is In Repair but has no open repair record, so it can&apos;t be closed here.
                        Ask an administrator to correct the record in the database.
                      </p>
                    ))}
                </>
              )}

              {asset.status === "Retired" && (
                <>
                  <p className="text-sm text-slate-600">Retired — no longer handed out.</p>
                  {canUpdate && (
                    <div className="flex flex-col gap-2">
                      <Link href={statusHref("Disposed")} className={`${primaryButtonClass} block text-center`}>
                        Mark as disposed
                      </Link>
                      <Link href={statusHref("Unassigned")} className={`${secondaryButtonClass} block text-center`}>
                        Put back in stock
                      </Link>
                    </div>
                  )}
                </>
              )}
              {asset.status === "Disposed" && <p className="text-sm text-slate-600">Disposed — end of its life.</p>}
              {asset.status === "Lost" && (
                <>
                  <p className="text-sm text-slate-600">Marked as lost.</p>
                  {canUpdate && (
                    <Link href={statusHref("Unassigned")} className={`${secondaryButtonClass} block text-center`}>
                      Found — put back in stock
                    </Link>
                  )}
                </>
              )}

              {/* Less common actions */}
              {(showSendForRepair || (canUpdate && !isSystemManaged)) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-sm">
                  {showSendForRepair && (
                    <Link href={`${basePath}?repair=1`} className="font-medium text-blue-700 hover:underline">
                      Send for repair
                    </Link>
                  )}
                  {canUpdate && asset.status === "Unassigned" && (
                    <Link href={statusHref("Retired")} className="font-medium text-slate-600 hover:underline">
                      Retire
                    </Link>
                  )}
                  {canUpdate && !isSystemManaged && (
                    <Link href={statusHref()} className="text-slate-500 hover:underline">
                      Other status…
                    </Link>
                  )}
                </div>
              )}
              {asset.status === "In Use" && showSendForRepair && openAssignment && (
                <p className="text-xs text-slate-400">
                  A repair keeps it assigned to {nameOf(openAssignment.person_id)}; it returns to In Use when the repair
                  is closed.
                </p>
              )}
              {canUpdate && isSystemManaged && (
                <p className="text-xs text-slate-400">
                  {asset.status === "In Use"
                    ? "Status changes after the return is recorded."
                    : "Status changes when the repair is closed."}
                </p>
              )}
            </div>
          </section>

          <Panel title="Record">
            <dl className="space-y-3">
              <Fact label="Registered">
                {formatDateTime(asset.created_at)}
                {asset.created_by && personNames.get(asset.created_by) ? ` by ${personNames.get(asset.created_by)}` : ""}
              </Fact>
              <Fact label="Last updated">
                {formatDateTime(asset.updated_at)}
                {asset.updated_by && personNames.get(asset.updated_by) ? ` by ${personNames.get(asset.updated_by)}` : ""}
              </Fact>
            </dl>
          </Panel>
        </aside>
      </div>

      {showAssign && sp.assign === "1" && (
        <Modal key={Date.now()} closeHref={basePath} title="Assign asset">
          <AssetAssignForm assetId={asset.id} defaultCondition={asset.condition} />
        </Modal>
      )}
      {showReturn && openAssignment && sp.return === "1" && (
        <Modal key={Date.now()} closeHref={basePath} title="Return asset">
          <AssetReturnForm
            assetId={asset.id}
            assignedDate={openAssignment.assigned_date}
            assignedCondition={openAssignment.assigned_condition}
            holderName={nameOf(openAssignment.person_id)}
          />
        </Modal>
      )}
      {showSendForRepair && sp.repair === "1" && (
        <Modal key={Date.now()} closeHref={basePath} title="Send for repair">
          <form action={openMaintenance.bind(null, asset.id)} className="space-y-3">
            <div>
              <label className={labelClass}>Issue type *</label>
              <input name="issue_type" required placeholder="e.g. Screen, Battery, Keyboard" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <textarea name="description" rows={2} placeholder="Optional" className={inputClass} />
            </div>
            <div>
              {/* Left empty = today, decided by the database (no server-timezone guess). */}
              <label className={labelClass}>Service date (leave empty for today)</label>
              <input type="date" name="service_date" className={inputClass} />
            </div>
            <button type="submit" className={primaryButtonClass}>
              Send for repair
            </button>
          </form>
        </Modal>
      )}
      {showCloseRepair && openRepair && sp.repair === "1" && (
        <Modal key={Date.now()} closeHref={basePath} title="Close repair">
          <p className="mb-3 text-sm text-slate-500">
            In repair since {formatDate(openRepair.service_date)}:{" "}
            <span className="font-medium text-slate-900">{openRepair.issue_type}</span>.
          </p>
          <form action={closeMaintenance.bind(null, asset.id, openRepair.id)} className="space-y-3">
            <div>
              <label className={labelClass}>Resolution *</label>
              <textarea name="resolution" required rows={2} placeholder="e.g. Battery replaced" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Cost (PKR)</label>
              <input type="number" name="cost" min="0" step="0.01" placeholder="Optional" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Returned date (leave empty for today)</label>
              <input type="date" name="returned_date" min={openRepair.service_date} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Remarks</label>
              <input name="remarks" placeholder="Optional" className={inputClass} />
            </div>
            <button type="submit" className={primaryButtonClass}>
              Close repair
            </button>
          </form>
        </Modal>
      )}
      {canUpdate && !isSystemManaged && sp.status && (sp.status === "1" || presetStatus) && (
        <Modal key={Date.now()} closeHref={basePath} title="Change status">
          <form action={changeAssetStatus.bind(null, asset.id)} className="space-y-3">
            <div>
              <label className={labelClass}>New status</label>
              <select name="status" required defaultValue={presetStatus} className={inputClass}>
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
        </Modal>
      )}
    </div>
  );
}
