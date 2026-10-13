import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { fetchCategoryMaps, fetchOrgUnits } from "@/lib/it/ticket-data";
import { createItTicket } from "../actions";
import { FormMessage, secondaryButtonClass } from "../../_components/ticket-ui";
import { TicketForm } from "./ticket-form";

// SCR-01 — Raise IT Support Ticket.
export default async function NewItTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");

  const [{ categories, requestTypes }, { sites, departments }, { data: person }] =
    await Promise.all([
      fetchCategoryMaps(supabase),
      fetchOrgUnits(supabase),
      supabase.from("persons").select("site_id").eq("id", personId ?? "").maybeSingle(),
    ]);

  return (
    <div className="py-6">
      <PageHeader
        title="Raise IT Ticket"
        description="Tell IT what you need. You'll get a ticket number to track it."
        action={
          <Link href="/it/my-tickets" className={secondaryButtonClass}>
            Back to my tickets
          </Link>
        }
      />
      <FormMessage error={error} />
      <TicketForm
        action={createItTicket}
        requestTypes={requestTypes.filter((t) => t.is_active)}
        categories={categories.filter((c) => c.is_active)}
        sites={sites}
        departments={departments}
        defaultSiteId={person?.site_id ?? null}
      />
    </div>
  );
}
