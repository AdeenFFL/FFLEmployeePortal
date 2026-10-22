import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export const ATTACHMENT_BUCKET = "it-ticket-attachments";

// For a page's MAIN query: turn a Supabase error into a thrown error, so app/(protected)/it/
// error.tsx explains it. Without this, a failed query reads as "no data" — e.g. the onboarding
// queue showed "No requests" while the `it` schema was unreachable. Secondary lookups (names,
// labels) stay best-effort and don't use this.
export function checked<R extends { error: { message: string } | null }>(result: R): R {
  if (result.error) throw new Error(result.error.message);
  return result;
}

// public.persons is only readable by the person themself / admins, so names on tickets go
// through it.person_names() — it returns only the people this viewer is allowed to see
// (javaria_it_0001_tickets.sql, Part E).
export async function fetchPersonNames(supabase: Client, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map<string, string>();

  const { data } = await supabase.schema("it").rpc("person_names", { p_person_ids: unique });
  return new Map((data ?? []).map((p) => [p.person_id, p.full_name]));
}

// Separate from fetchPersonNames on purpose: it.asset_person_names has no active-employee
// filter, so someone who has since left the company still shows by name in assignment history
// (inventory/[id]/page.tsx) — it.person_names (above) doesn't guarantee that for its own callers
// (tickets, onboarding), so the two aren't interchangeable despite the similar shape.
export async function fetchAssetPersonNames(supabase: Client, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map<string, string>();

  const { data } = await supabase.schema("it").rpc("asset_person_names", { p_person_ids: unique });
  return new Map((data ?? []).map((p) => [p.person_id, p.full_name]));
}

export async function fetchOrgUnits(supabase: Client) {
  const { data } = await supabase.schema("it").rpc("list_org_units");
  const units = data ?? [];
  return {
    sites: units.filter((u) => u.type === "Site"),
    departments: units.filter((u) => u.type === "Department"),
    nameById: new Map(units.map((u) => [u.id, u.name])),
  };
}

export async function fetchCategoryMaps(supabase: Client) {
  const [{ data: categories }, { data: requestTypes }] = await Promise.all([
    supabase
      .schema("it")
      .from("ticket_categories")
      .select("id, parent_id, name, is_active, sort_order")
      .order("sort_order")
      .order("name"),
    supabase
      .schema("it")
      .from("request_types")
      .select("id, name, description, is_active")
      .eq("applies_to", "Ticket")
      .order("name"),
  ]);

  return {
    categories: categories ?? [],
    requestTypes: requestTypes ?? [],
    categoryNameById: new Map((categories ?? []).map((c) => [c.id, c.name])),
    requestTypeNameById: new Map((requestTypes ?? []).map((t) => [t.id, t.name])),
  };
}

// "AST-000123 · HP ProBook 450 (SN 5CG1234)" for the asset a ticket is about. Goes through
// it.ticket_asset_labels() because most ticket viewers can't read it.assets directly
// (javaria_it_0004_ticket_asset_link.sql).
export async function fetchAssetLabels(supabase: Client, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map<string, string>();

  const { data } = await supabase
    .schema("it")
    .rpc("ticket_asset_labels", { p_asset_ids: unique });
  return new Map(
    (data ?? []).map((a) => [a.asset_id, `${a.asset_tag} · ${a.asset_name} (SN ${a.serial_number})`]),
  );
}

// The viewer's ticket scope (javaria_it_0005_site_routing.sql): HQ Executive or not, which
// sites' IT teams they're on, which they manage. Drives what the ticket screens offer; the
// database enforces the same rules independently.
export type TicketScope = {
  readAll: boolean;
  hqExecutive: boolean;
  siteIds: string[];
  managedSiteIds: string[];
  hqSiteId: string | null;
};

export async function fetchTicketScope(supabase: Client): Promise<TicketScope> {
  const { data } = await supabase.schema("it").rpc("my_ticket_scope");
  const row = data?.[0];
  return {
    readAll: Boolean(row?.read_all),
    hqExecutive: Boolean(row?.hq_executive),
    siteIds: row?.site_ids ?? [],
    managedSiteIds: row?.managed_site_ids ?? [],
    hqSiteId: row?.hq_site_id ?? null,
  };
}

export function canManageSite(scope: TicketScope, siteId: string | null) {
  return scope.hqExecutive || (siteId !== null && scope.managedSiteIds.includes(siteId));
}

export async function hasItPermission(supabase: Client, key: string) {
  const { data } = await supabase.rpc("has_permission", { p_permission_key: key });
  return Boolean(data);
}

export async function signedAttachmentUrls(supabase: Client, paths: string[]) {
  if (paths.length === 0) return new Map<string, string>();
  const { data } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrls(paths, 600);
  const urls = new Map<string, string>();
  for (const d of data ?? []) {
    if (d.path && d.signedUrl) urls.set(d.path, d.signedUrl);
  }
  return urls;
}
