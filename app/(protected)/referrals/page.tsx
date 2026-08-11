import { PageHeader } from "@/components/page-header";

export default function ReferralsPage() {
  return (
    <div className="py-6">
      <PageHeader
        title="Referrals"
        description="Refer candidates for open positions."
      />
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm text-slate-500">
          Employee referrals is a future module — nothing to show here yet.
        </p>
      </div>
    </div>
  );
}
