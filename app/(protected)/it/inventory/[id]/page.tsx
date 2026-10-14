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
import { changeAssetStatus, deleteAsset } from "../actions";
import {
  ASSET_STATUS_TONES,
  formatDate,
  MANUAL_STATUSES,
  SYSTEM_MANAGED_STATUSES,
} from "../asset-status";
import { DeleteAssetButton } from "./delete-asset-button";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={`${cardClass} p-5`}>
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

// INV-03 — one asset. Overview + linked tickets for now; the assignment, maintenance, movements,
// valuation and origin sections arrive with Phases 3–7 (07-it-inventory-plan.md §4).
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
  ] = await Promise.all([
    supabase.from("companies").select("name").eq("id", asset.company_id).maybeSingle(),
    fetchOrgUnits(supabase),
    fetchPersonNames(supabase, [asset.created_by, asset.updated_by]),
    hasItPermission(supabase, "it.assets.update"),
    hasItPermission(supabase, "it.assets.delete"),
    hasItPermission(supabase, "it.tickets.read"),
  ]);

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
