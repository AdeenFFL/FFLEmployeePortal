import { PageHeader } from "@/components/page-header";

export default function QuarterQuestPage() {
  return (
    <div className="py-6">
      <PageHeader
        title="Quarter Quest"
        description="Quarterly engagement activities and challenges."
      />
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm text-slate-500">
          Quarter Quest is a future module — nothing to show here yet.
        </p>
      </div>
    </div>
  );
}
