import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export const ATTACHMENT_BUCKET = "it-ticket-attachments";

// public.persons is only readable by the person themself / admins, so names on tickets go
// through it.person_names() — it returns only the people this viewer is allowed to see
// (javaria_it_0001_tickets.sql, Part E).
export async function fetchPersonNames(supabase: Client, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map<string, string>();

  const { data } = await supabase.schema("it").rpc("person_names", { p_person_ids: unique });
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
