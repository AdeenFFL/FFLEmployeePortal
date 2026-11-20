import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/status-pill";
import { DEMAND_STATUS_TONE } from "@/lib/it/procurement";
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
import { changeAssetStatus, closeMaintenance, deleteAsset, setAssetValue } from "../actions";
import { FormDrawer } from "../_components/drawer";
import { bookValue, formatPkr } from "../valuation";
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

// `at` is the business date shown; `seq` is when the row was written, which orders events that
// share a date (assign / return / repair dates are plain dates without a time).
type HistoryEvent = {
  at: string;
  seq: string;
  tone: "blue" | "emerald" | "amber" | "slate";
  title: string;
  lines: string[];
};

const HISTORY_SHOWN = 6;

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
    value?: string;
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
    // repair demands (javaria_it_0023): the demand does the work, this shows where it is.
    supabase
      .schema("it")
      .from("asset_maintenance")
      .select("id, kind, ticket_id, demand_id, vendor_id, issue_type, description, service_date, returned_date, status, resolution, cost, remarks, created_at, updated_at")
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
      "id, person_id, assigned_by_person_id, returned_to_person_id, assigned_date, return_date, assigned_condition, returned_condition, acknowledged_at, remarks, created_at, updated_at",
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
  const showBookService = canMaintain && (asset.status === "Unassigned" || asset.status === "In Use");
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

  // The repair demands behind this asset, vendors and spare parts (javaria_it_0023). Demands follow
  // RLS, so someone without access sees the repair here but no link to it.
  const repairIds = repairs.map((r) => r.id);
  const demandIds = repairs.map((r) => r.demand_id).filter((d): d is string => Boolean(d));
  const [{ data: vendorRows }, { data: repairDemands }, { data: partRows }, { data: productRows }, canRaiseDemand] =
    await Promise.all([
      supabase.schema("it").from("vendors").select("id, vendor_name").order("vendor_name"),
      demandIds.length
        ? supabase.schema("it").from("demands").select("id, demand_number, status").in("id", demandIds)
        : Promise.resolve({ data: [] }),
      repairIds.length
        ? supabase
            .schema("it")
            .from("stock_movements")
            .select("maintenance_id, product_id, quantity")
            .in("maintenance_id", repairIds)
        : Promise.resolve({ data: [] }),
      supabase.schema("it").from("products").select("id, product_name"),
      hasItPermission(supabase, "it.demands.create"),
    ]);
  const vendorName = new Map((vendorRows ?? []).map((v) => [v.id, v.vendor_name]));
  const productById = new Map((productRows ?? []).map((pr) => [pr.id, pr]));
  const demandById = new Map((repairDemands ?? []).map((d) => [d.id, d]));
  const partsOf = (repairId: string) =>
    (partRows ?? [])
      .filter((m) => m.maintenance_id === repairId)
      .map((m) => `${-m.quantity} × ${productById.get(m.product_id)?.product_name ?? "part"}`);
  const openDemand = openRepair?.demand_id ? demandById.get(openRepair.demand_id) : undefined;
  const openTicket = (tickets ?? []).find((t) => !["Resolved", "Closed"].includes(t.status));
  const canRaiseRepair = canMaintain && canRaiseDemand;

  // Valuation (Phase 6): history of it.asset_values rows, newest first; the latest drives the
  // book value. Values are readable by it.assets.read holders, written with it.valuation.update.
  const [{ data: valueRows }, { data: valueTypes }, canValue] = await Promise.all([
    supabase
      .schema("it")
      .from("asset_values")
      .select("id, value_type_id, purchase_value, salvage_value, valuation_date, remarks, created_at")
      .eq("asset_id", asset.id)
      .order("valuation_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.schema("it").from("asset_value_types").select("*"),
    hasItPermission(supabase, "it.valuation.update"),
  ]);
  const valuations = valueRows ?? [];
  const latestValue = valuations[0] ?? null;
  const valueRule = latestValue ? (valueTypes ?? []).find((v) => v.id === latestValue.value_type_id) : undefined;
  const book = latestValue && valueRule ? bookValue(latestValue, valueRule, new Date()) : null;

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
      seq: asset.created_at,
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
        seq: a.created_at,
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
              seq: a.updated_at,
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
        seq: r.created_at,
        tone: "amber",
        title: `${r.kind === "Service" ? "Service" : "Sent for repair"} — ${r.issue_type}`,
        lines: [
          ...(r.demand_id && demandById.get(r.demand_id) ? [`Demand ${demandById.get(r.demand_id)?.demand_number}`] : []),
          ...(r.description ? [r.description] : []),
        ],
      },
      ...(r.status !== "Open" && r.returned_date
        ? [
            {
              at: r.returned_date,
              seq: r.updated_at,
              tone: "blue" as const,
              title: r.kind === "Service" ? "Service finished" : "Back from repair",
              lines: [
                [r.resolution, r.cost ? formatCost(r.cost) : null].filter(Boolean).join(" · "),
                ...(r.vendor_id ? [`Vendor: ${vendorName.get(r.vendor_id) ?? "—"}`] : []),
                ...(partsOf(r.id).length ? [`Parts: ${partsOf(r.id).join(", ")}`] : []),
                ...(r.demand_id && demandById.get(r.demand_id) ? [`Demand ${demandById.get(r.demand_id)?.demand_number}`] : []),
                ...(r.remarks ? [r.remarks] : []),
              ].filter(Boolean),
            },
          ]
        : []),
    ]),
  ].sort((a, b) => b.at.slice(0, 10).localeCompare(a.at.slice(0, 10)) || b.seq.localeCompare(a.seq));

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

          <Panel
            title="Value"
            aside={
              canValue ? (
                <Link href={`${basePath}?value=1`} className="text-sm font-medium text-blue-700 hover:underline">
                  {latestValue ? "Revalue" : "Set value"}
                </Link>
              ) : undefined
            }
          >
            {book && valueRule && latestValue ? (
              <>
                <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Book value today</p>
                    <p className="text-2xl font-semibold tabular-nums text-slate-900">{formatPkr(book.current)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Bought for</p>
                    <p className="text-sm tabular-nums text-slate-700">{formatPkr(book.purchase)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Depreciated</p>
                    <p className="text-sm tabular-nums text-slate-700">{formatPkr(book.depreciated)}</p>
                  </div>
                </div>
                <div
                  className="mt-4 h-1.5 w-full rounded-full bg-slate-100"
                  role="progressbar"
                  aria-label="Depreciation used"
                  aria-valuenow={Math.round(book.used * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${Math.round(book.used * 100)}%` }} />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {valueRule.name} asset · {valueRule.depreciation_method}, {valueRule.depreciation_percentage}% a year
                  {valueRule.useful_life_years ? ` over ${valueRule.useful_life_years} years` : ""} · since{" "}
                  {formatDate(latestValue.valuation_date)}
                  {book.fullyDepreciated && " · fully depreciated"}
                </p>
                {valuations.length > 1 && (
                  <details className="mt-3 text-xs text-slate-500">
                    <summary className="cursor-pointer font-medium text-slate-600">Earlier values ({valuations.length - 1})</summary>
                    <ul className="mt-2 space-y-1">
                      {valuations.slice(1).map((v) => (
                        <li key={v.id}>
                          {formatDate(v.valuation_date)} · {formatPkr(Number(v.purchase_value))}
                          {v.remarks && ` · ${v.remarks}`}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-500">
                No value recorded yet.
                {canValue ? " Set what it cost and whether it was bought New or Old to track its depreciation." : ""}
              </p>
            )}
          </Panel>

          <Panel title="Where it came from">
            {!vendor && !asset.purchase_date && !asset.receiving_id ? (
              <p className="text-sm text-slate-500">
                Added by hand — no vendor or purchase date recorded.{" "}
                {canUpdate && (
                  <Link href={`/it/inventory/${asset.id}/edit`} className="font-medium text-blue-700 hover:underline">
                    Add them
                  </Link>
                )}
              </p>
            ) : (
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
            )}
          </Panel>

          <Panel title="History" aside={<span className="text-xs text-slate-400">Newest first</span>}>
            {historyError || maintenanceError ? (
              <p className="mb-3 text-sm text-red-600">
                Part of the history couldn&apos;t be loaded: {(historyError ?? maintenanceError)?.message}
              </p>
            ) : null}
            <HistoryList events={events.slice(0, HISTORY_SHOWN)} />
            {events.length > HISTORY_SHOWN && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-blue-700">
                  Show {events.length - HISTORY_SHOWN} older event{events.length - HISTORY_SHOWN === 1 ? "" : "s"}
                </summary>
                <div className="mt-4">
                  <HistoryList events={events.slice(HISTORY_SHOWN)} />
                </div>
              </details>
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
                    {openRepair?.kind === "Service" ? "In service" : "In repair"} since{" "}
                    {openRepair ? formatDate(openRepair.service_date) : "—"}
                    {openRepair && (
                      <>
                        : <span className="font-medium text-slate-900">{openRepair.issue_type}</span>
                      </>
                    )}
                    .
                    {openAssignment && ` It goes back to ${nameOf(openAssignment.person_id)} when closed.`}
                  </p>
                  {openDemand && (
                    <Link
                      href={`/it/procurement/demands/${openDemand.id}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
                    >
                      <span className="font-medium text-slate-900">{openDemand.demand_number}</span>
                      <StatusPill label={openDemand.status} tone={DEMAND_STATUS_TONE[openDemand.status]} />
                    </Link>
                  )}
                  {openRepair?.demand_id && (
                    <p className="text-xs text-slate-400">Procurement handles this repair. Device back is recorded on the demand.</p>
                  )}
                  {showCloseRepair &&
                    (openRepair ? (
                      <>
                        {!openRepair.demand_id && (
                          <Link href={`${basePath}?repair=1`} className={`${primaryButtonClass} block text-center`}>
                            Close repair
                          </Link>
                        )}
                        {canRaiseDemand && (
                          <Link
                            href={`/it/procurement/demands/new?repair=${openRepair.id}`}
                            className="block text-center text-sm font-medium text-blue-700 hover:underline"
                          >
                            Order a spare part
                          </Link>
                        )}
                      </>
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
              {(showBookService || (canUpdate && !isSystemManaged)) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-sm">
                  {showBookService && canRaiseRepair && (
                    <Link
                      href={`/it/procurement/demands/new?category=Maintenance&asset=${asset.id}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      Book a service
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
              {showBookService && (
                <p className="text-xs text-slate-400">
                  Repairs start from the IT ticket
                  {openTicket && (
                    <>
                      {" "}
                      (
                      <Link href={`/it/tickets/${openTicket.id}`} className="font-medium text-blue-700 hover:underline">
                        {openTicket.ticket_number}
                      </Link>
                      )
                    </>
                  )}
                  .{openAssignment && ` The asset stays with ${nameOf(openAssignment.person_id)} and goes back when closed.`}
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
      {showCloseRepair && openRepair && !openRepair.demand_id && sp.repair === "1" && (
        <FormDrawer
          closeHref={basePath}
          title="Close repair"
          description={`${openRepair.issue_type}, since ${formatDate(openRepair.service_date)}.`}
          action={closeMaintenance.bind(null, asset.id, openRepair.id)}
          submitLabel="Close repair"
        >
          <label className="block">
            <span className={labelClass}>Resolution *</span>
            <textarea name="resolution" required rows={2} placeholder="e.g. Battery replaced" className={inputClass} />
          </label>
          <label className="block">
            <span className={labelClass}>Cost (PKR)</span>
            <input type="number" name="cost" min="0" step="0.01" placeholder="Optional" className={inputClass} />
          </label>
          <label className="block">
            <span className={labelClass}>Returned date (leave empty for today)</span>
            <input type="date" name="returned_date" min={openRepair.service_date} className={inputClass} />
          </label>
          <label className="block">
            <span className={labelClass}>Remarks</span>
            <input name="remarks" placeholder="Optional" className={inputClass} />
          </label>
        </FormDrawer>
      )}
      {canValue && sp.value === "1" && (
        <FormDrawer
          closeHref={basePath}
          title={latestValue ? "Revalue asset" : "Set asset value"}
          description="Book value is worked out from this and the New / Old rules in Inventory settings."
          action={setAssetValue.bind(null, asset.id)}
          submitLabel="Save value"
        >
          <fieldset>
            <legend className={labelClass}>Bought as</legend>
            <div className="grid grid-cols-2 gap-2">
              {(valueTypes ?? []).map((v) => (
                <label
                  key={v.id}
                  className="flex cursor-pointer flex-col rounded-xl border border-slate-200 px-3 py-2.5 hover:border-slate-300 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50/50"
                >
                  <input
                    type="radio"
                    name="value_type_id"
                    value={v.id}
                    required
                    defaultChecked={(latestValue?.value_type_id ?? (valueTypes ?? []).find((t) => t.name === "New")?.id) === v.id}
                    className="sr-only"
                  />
                  <span className="text-sm font-medium text-slate-900">{v.name}</span>
                  <span className="text-xs text-slate-500">
                    {v.depreciation_percentage}% a year{v.useful_life_years ? ` · ${v.useful_life_years} yrs` : ""}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>Purchase value (Rs)</span>
              <input
                name="purchase_value"
                inputMode="decimal"
                required
                defaultValue={latestValue?.purchase_value ?? ""}
                className={`${inputClass} tabular-nums`}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Salvage value (Rs)</span>
              <input
                name="salvage_value"
                inputMode="decimal"
                defaultValue={latestValue?.salvage_value ?? ""}
                placeholder="0"
                className={`${inputClass} tabular-nums`}
              />
            </label>
          </div>
          <label className="block">
            <span className={labelClass}>Value starts from</span>
            <input
              name="valuation_date"
              type="date"
              required
              defaultValue={latestValue?.valuation_date ?? asset.purchase_date ?? asset.created_at.slice(0, 10)}
              className={inputClass}
            />
            <span className="mt-1 block text-xs text-slate-400">Usually the purchase date. Depreciation counts from here.</span>
          </label>
          <label className="block">
            <span className={labelClass}>
              Note <span className="font-normal text-slate-400">(optional)</span>
            </span>
            <input name="remarks" placeholder="e.g. Invoice INV-2291" className={inputClass} />
          </label>
        </FormDrawer>
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

function HistoryList({ events }: { events: HistoryEvent[] }) {
  return (
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
  );
}
