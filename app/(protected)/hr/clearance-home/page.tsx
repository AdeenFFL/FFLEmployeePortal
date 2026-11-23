import Link from "next/link";
import { getCurrentUserNav } from "../../current-user";
import { isClearanceSigner } from "../clearance/clearance-nav";
import { loadMySigningTasks } from "../clearance/it-clearance-work";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";

type ClearanceCard = {
  href: string;
  title: string;
  description: string | null;
  // A short live count, or null.
  badge: string | null;
};

// The one "Clearance" entry of HR Management: a card per clearance screen. Each card shows only
// with the permission its own page needs (the same keys as lib/auth/route-permissions.ts).
export default async function ClearanceHomePage() {
  const [{ permissions }, isSigner] = await Promise.all([getCurrentUserNav(), isClearanceSigner()]);
  const granted = new Set(permissions);
  const canReadAll = granted.has("hr.clearance.read_all");
  const canSign = granted.has("hr.clearance.sign");
  const isItStaff = granted.has("it.tickets.update");

  const supabase = await createClient();
  const hr = supabase.schema("hr");
  const countByStatus = (status: "Submitted" | "In Clearance") =>
    hr.from("clearance_cases").select("id", { count: "exact", head: true }).eq("status", status);

  // Parts waiting for my signature (Clearance to sign card).
  const toSignCount =
    canSign && isSigner
      ? await supabase
          .rpc("current_person_id")
          .then(({ data: personId }) =>
            personId ? loadMySigningTasks(supabase, personId, "open").then((t) => t.length) : 0,
          )
      : 0;

  const [submitted, inClearance, lineTasks, assetTasks] = await Promise.all([
    canReadAll ? countByStatus("Submitted") : Promise.resolve({ count: null }),
    canReadAll ? countByStatus("In Clearance") : Promise.resolve({ count: null }),
    canSign ? hr.rpc("my_clearance_tasks") : Promise.resolve({ data: [] }),
    canSign ? hr.rpc("my_clearance_asset_tasks") : Promise.resolve({ data: [] }),
  ]);

  const openTasks =
    (lineTasks.data ?? []).filter(
      (t) => t.case_status === "In Clearance" && !t.part_locked && !t.outcome,
    ).length +
    (assetTasks.data ?? []).filter(
      (t) => t.case_status === "In Clearance" && !t.part_locked && !t.returned,
    ).length;
  const hasAnyTask = (lineTasks.data ?? []).length + (assetTasks.data ?? []).length > 0;

  const cards: ClearanceCard[] = [];
  if (canReadAll) {
    cards.push({
      href: "/hr/clearance-requests",
      title: "Clearance Requests",
      description: null,
      badge:
        submitted.count !== null && inClearance.count !== null
          ? `${submitted.count} waiting to forward · ${inClearance.count} in clearance`
          : null,
    });
  }
  // Every role holds hr.clearance.sign; only people set as a signer get this card.
  if (canSign && isSigner) {
    cards.push({
      href: "/hr/clearance",
      title: "Clearance to sign",
      description: null,
      badge: toSignCount > 0 ? `${toSignCount} waiting for you` : "Nothing to sign",
    });
  }
  if (canReadAll) {
    cards.push({
      href: "/hr/admin/clearance-signers",
      title: "Clearance Signers",
      description: null,
      badge: null,
    });
  }
  if (canSign && (isItStaff || hasAnyTask)) {
    cards.push({
      href: "/hr/clearance/tasks",
      title: "My clearance tasks",
      description: null,
      badge: openTasks > 0 ? `${openTasks} open task${openTasks === 1 ? "" : "s"}` : "No open tasks",
    });
  }

  return (
    <div className="py-6">
      <PageHeader
        title="Clearance"
      />

      {cards.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-slate-400">You have no clearance screens.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
            >
              <p className="text-base font-semibold text-slate-900 group-hover:text-blue-700">
                {card.title}
              </p>
              {card.description && <p className="text-sm text-slate-500">{card.description}</p>}
              {card.badge && (
                <p className="mt-1 w-fit rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                  {card.badge}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
