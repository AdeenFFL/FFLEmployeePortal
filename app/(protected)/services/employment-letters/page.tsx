import { PageHeader } from "@/components/page-header";

export default function EmploymentLettersPage() {
  return (
    <div className="py-6">
      <PageHeader
        title="Employment Letters"
        description="Request salary certificates, experience letters, and other documents."
      />
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm text-slate-500">
          Employment letter requests is a future module — nothing to show here yet.
        </p>
      </div>
    </div>
  );
}
