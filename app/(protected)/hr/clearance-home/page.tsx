import Link from "next/link";
import { getCurrentUserNav } from "../../current-user";
import { isClearanceSigner } from "../clearance/clearance-nav";
import { loadMySigningTasks } from "../clearance/it-clearance-work";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import {
  CheckIcon,
  LogIcon,
  MailIcon,
  PencilIcon,
  UsersIcon,
} from "@/components/icons";
import { EmptyState } from "../clearance/empty-state";

type ClearanceCard = {
  href: string;
  title: string;
  // A small icon so each card is easy to spot.
  icon: (props: { className?: string }) => React.ReactNode;
  description: string | null;
  // A short live count, or null.
  badge: string | null;
  // Show the badge red: something is waiting for this person.
  alert?: boolean;
};

// The one "Clearance" entry of HR Management: a card per clearance screen. Each card shows only
// with the permission its own page needs (the same keys as lib/auth/route-permissions.ts).
export default async function ClearanceHomePage() {
  const [{ permissions }, isSigner] = await Promise.all([
    getCurrentUserNav(),
    isClearanceSigner(),
  ]);
  const granted = new Set(permissions);
  const canReadAll = granted.has("hr.clearance.read_all");
  const canSign = granted.has("hr.clearance.sign");
  const isItStaff = granted.has("it.tickets.update");

  const supabase = await createClient();
  const hr = supabase.schema("hr");
  const countByStatus = (status: "Submitted" | "In Clearance") =>
    hr
      .from("clearance_cases")
      .select("id", { count: "exact", head: true })
      .eq("status", status);

  // Parts waiting for my signature (Clearance to sign card).
  const toSignCount =
    canSign && isSigner
      ? await supabase
          .rpc("current_person_id")
          .then(({ data: personId }) =>
            personId
              ? loadMySigningTasks(supabase, personId, "open").then(
                  (t) => t.length,
                )
              : 0,
          )
      : 0;

  const [submitted, inClearance, lineTasks, assetTasks] = await Promise.all([
    canReadAll ? countByStatus("Submitted") : Promise.resolve({ count: null }),
    canReadAll
      ? countByStatus("In Clearance")
      : Promise.resolve({ count: null }),
    canSign ? hr.rpc("my_clearance_tasks") : Promise.resolve({ data: [] }),
    canSign
      ? hr.rpc("my_clearance_asset_tasks")
      : Promise.resolve({ data: [] }),
  ]);

  const openTasks =
    (lineTasks.data ?? []).filter(
      (t) => t.case_status === "In Clearance" && !t.part_locked && !t.outcome,
    ).length +
    (assetTasks.data ?? []).filter(
      (t) => t.case_status === "In Clearance" && !t.part_locked && !t.returned,
    ).length;
  const hasAnyTask =
    (lineTasks.data ?? []).length + (assetTasks.data ?? []).length > 0;

  const cards: ClearanceCard[] = [];
  if (canReadAll) {
    cards.push({
      href: "/hr/clearance-requests",
      title: "Clearance Requests",
      icon: LogIcon,
      description: null,
      badge:
        submitted.count !== null && inClearance.count !== null
          ? `${submitted.count} waiting to forward · ${inClearance.count} in clearance`
          : null,
    });
  }
  // The Submitted requests only (the list, filtered), with a red count while any wait.
  if (canReadAll) {
    const toForward = submitted.count ?? 0;
    cards.push({
      href: "/hr/clearance-requests?status=Submitted",
      title: "Clearance to forward",
      icon: MailIcon,
      description: null,
      badge: toForward > 0 ? `${toForward} to forward` : "Nothing to forward",
      alert: toForward > 0,
    });
  }
  // Every role holds hr.clearance.sign; only people set as a signer get this card.
  if (canSign && isSigner) {
    cards.push({
      href: "/hr/clearance",
      title: "Clearance to sign",
      icon: PencilIcon,
      description: null,
      badge:
        toSignCount > 0 ? `${toSignCount} waiting for you` : "Nothing to sign",
    });
  }
  if (canReadAll) {
    cards.push({
      href: "/hr/admin/clearance-signers",
      title: "Clearance Signers",
      icon: UsersIcon,
      description: null,
      badge: null,
    });
  }
  if (canSign && (isItStaff || hasAnyTask)) {
    cards.push({
      href: "/hr/clearance/tasks",
      title: "My clearance tasks",
      icon: CheckIcon,
      description: null,
      badge:
        openTasks > 0
          ? `${openTasks} open task${openTasks === 1 ? "" : "s"}`
          : "No open tasks",
    });
  }

  return (
    <div className="py-6">
      <PageHeader title="Clearance" />

      {cards.length === 0 ? (
        <EmptyState icon="🗂️" text="You have no clearance screens." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700 group-hover:bg-blue-100">
                  <card.icon className="h-4 w-4" />
                </span>
                <p className="text-base font-semibold text-slate-900 group-hover:text-blue-700">
                  {card.title}
                </p>
              </div>
              {card.description && (
                <p className="text-sm text-slate-500">{card.description}</p>
              )}
              {card.badge && (
                <p
                  className={`mt-1 w-fit rounded-full px-2.5 py-1 text-xs font-medium ${
                    card.alert
                      ? "bg-red-500 text-white"
                      : "bg-blue-50 text-blue-700"
                  }`}
                >
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
