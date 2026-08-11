import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { AuditAction } from "@/types/database";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Uses the same RLS-respecting client the calling mutation already used. A logging failure
// never blocks the mutation it's attached to (already committed by the time this runs) —
// swallow + log server-side rather than throw.
export async function logAuditEvent({
  supabase,
  actorId,
  actorLabel,
  module,
  action,
  details,
}: {
  supabase: SupabaseServerClient;
  actorId: string;
  actorLabel: string;
  module: string;
  action: AuditAction;
  details: string;
}) {
  const { error } = await supabase
    .from("audit_log")
    .insert({ actor_id: actorId, actor_label: actorLabel, module, action, details });
  if (error) console.error("logAuditEvent: insert failed", error);
}
