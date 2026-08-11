import { PageHeader } from "@/components/page-header";

export default function MyRequestsPage() {
  return (
    <div className="py-6">
      <PageHeader
        title="My Requests"
        description="Track tickets and requests you've submitted."
      />
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm text-slate-500">
          A unified view of your open and past requests is a future module — nothing to show
          here yet.
        </p>
      </div>
    </div>
  );
}
