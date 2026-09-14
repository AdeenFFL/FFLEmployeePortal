import { PageHeader } from "@/components/page-header";

export default function PolicyLibraryPage() {
  return (
    <div className="py-6">
      <PageHeader
        title="Policy Library"
        description="Company policies and employee handbooks."
      />
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm text-slate-500">
          The policy library is a future module — nothing to show here yet.
        </p>
      </div>
    </div>
  );
}
