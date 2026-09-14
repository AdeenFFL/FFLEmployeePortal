import { PageHeader } from "@/components/page-header";

export default function HrContactDirectoryPage() {
  return (
    <div className="py-6">
      <PageHeader
        title="HR Contact Directory"
        description="Find the right HR contact for your site or department."
      />
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm text-slate-500">
          The HR contact directory is a future module — nothing to show here yet.
        </p>
      </div>
    </div>
  );
}
