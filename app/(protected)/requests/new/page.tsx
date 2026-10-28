import Link from "next/link";
import { getCurrentUserNav } from "../../current-user";
import { PageHeader } from "@/components/page-header";
import { TicketIcon, BuildingIcon } from "@/components/icons";
import { secondaryButtonClass } from "../../it/_components/ticket-ui";

// The front door for raising anything — purely a routing/UX layer in front of the two
// existing, separate create flows (hr.tickets vs it.tickets). Pairs with /requests the same
// way /it/my-onboarding's "+ New" button pairs with /it/my-onboarding/new.
export default async function NewRequestPage() {
  const { permissions } = await getCurrentUserNav();
  const granted = new Set(permissions);

  const choices = [
    {
      href: "/it/my-tickets/new",
      label: "IT issue",
      description: "Hardware, software, access, accounts, or anything tech-related.",
      icon: TicketIcon,
      permission: "module:it",
    },
    {
      href: "/hr/tickets",
      label: "HR question",
      description: "Benefits, policy, or anything HR-related.",
      icon: BuildingIcon,
      permission: "module:hr",
    },
  ].filter((c) => granted.has(c.permission));

  return (
    <div className="py-6">
      <PageHeader
        title="Raise a Ticket"
        description="Choose what this is about — you'll go straight to the right form."
        action={
          <Link href="/requests" className={secondaryButtonClass}>
            Back to My Requests
          </Link>
        }
      />

      {choices.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-slate-400">
            You don&apos;t have access to either ticketing system yet.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {choices.map((c) => {
            const Icon = c.icon;
            return (
              <Link
                key={c.href}
                href={c.href}
                className="group flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-100">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-base font-semibold text-slate-900">{c.label}</p>
                  <p className="mt-1 text-sm text-slate-500">{c.description}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
