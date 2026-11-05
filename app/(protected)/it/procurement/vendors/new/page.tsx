import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { hasItPermission } from "@/lib/it/ticket-data";
import { cardClass, FormMessage, primaryButtonClass, secondaryButtonClass } from "../../../_components/ticket-ui";
import { BackLink } from "../../_components/ui";
import { createVendor } from "../actions";
import { VendorFields } from "../vendor-fields";

// Add a supplier to the Vendor Master (PRC-01). Saving opens the new vendor's page.
export default async function NewVendorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  if (!(await hasItPermission(supabase, "it.vendors.update"))) notFound();

  return (
    <div className="mx-auto max-w-4xl py-6">
      <div className="mb-3">
        <BackLink href="/it/procurement/vendors" label="Vendors" />
      </div>
      <PageHeader title="Add vendor" description="Once saved, demands can be assigned to this supplier." />
      <FormMessage error={params.error} />

      <form action={createVendor} className={cardClass}>
        <VendorFields />
        <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <Link href="/it/procurement/vendors" className={secondaryButtonClass}>
            Cancel
          </Link>
          <button type="submit" className={primaryButtonClass}>
            Add vendor
          </button>
        </div>
      </form>
    </div>
  );
}
