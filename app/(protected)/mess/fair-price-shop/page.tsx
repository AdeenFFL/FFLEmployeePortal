import { PageHeader } from "@/components/page-header";

export default function FairPriceShopPage() {
  return (
    <div className="py-6">
      <PageHeader
        title="Fair Price Shop"
        description="Fair price shop catalog and pricing."
      />
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm text-slate-500">
          The fair price shop catalog is a future module — nothing to show here yet.
        </p>
      </div>
    </div>
  );
}
