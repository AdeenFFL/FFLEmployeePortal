import { PageHeader } from "@/components/page-header";

export default function InternalJobsPage() {
  return (
    <div className="py-6">
      <PageHeader
        title="Internal Jobs"
        description="Open positions available to current employees."
      />
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm text-slate-500">
          Internal job postings is a future module — nothing to show here yet.
        </p>
      </div>
    </div>
  );
}
