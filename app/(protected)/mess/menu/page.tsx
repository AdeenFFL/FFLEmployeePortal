import { PageHeader } from "@/components/page-header";

export default function MessMenuPage() {
  return (
    <div className="py-6">
      <PageHeader title="Mess Menu" description="This week's mess menu." />
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm text-slate-500">
          The mess menu is a future module — nothing to show here yet.
        </p>
      </div>
    </div>
  );
}
