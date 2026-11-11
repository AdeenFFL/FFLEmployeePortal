import Link from "next/link";
import { getCurrentUserNav } from "../current-user";
import { createClient } from "@/lib/supabase/server";
import { listOpenAssignments } from "@/lib/it/assets";
import { PageHeader } from "@/components/page-header";
import { UserIcon, TicketIcon, BuildingIcon, KeyIcon, LaptopIcon, LogoutIcon } from "@/components/icons";

type IconComponent = (props: { className?: string }) => React.ReactElement;

type QuickLink = {
  href: string;
  label: string;
  description: string;
  icon: IconComponent;
  permission?: string;
  count?: number;
};

// Access-based: which cards show up depends on the signed-in person's actual granted
// permissions (not a role name — see lib/auth/granted-permissions.ts), same source of truth
// proxy.ts already gates every route against — this is a shortcut to what they can already
// reach, not a separate permission surface. Every role lands here now (lib/auth/home-path.ts),
// so this is a real landing page, not just a fallback for people with no dedicated dashboard.
export default async function EmployeeHomePage() {
  const { displayName, permissions } = await getCurrentUserNav();
  const granted = new Set(permissions);

  const assetCount = granted.has("module:it")
    ? await (async () => {
        const supabase = await createClient();
        const { data: personId } = await supabase.rpc("current_person_id");
        if (!personId) return 0;
        const assignments = await listOpenAssignments(supabase, personId);
        return assignments.length;
      })()
    : 0;

  const quickLinks: QuickLink[] = [
    {
      href: "/profile",
      label: "My Profile",
      description: "View and update your personal and employment details.",
      icon: UserIcon,
    },
    {
      href: "/requests/new",
      label: "Raise a Ticket",
      description: "Report an IT issue or ask HR a question — we'll point you the right way.",
      icon: TicketIcon,
    },
    {
      href: "/requests",
      label: "My Requests",
      description: "Track tickets and requests you've submitted.",
      icon: TicketIcon,
    },
    {
      href: "/it/my-assets",
      label: "My Assets",
      description:
        assetCount > 0
          ? `${assetCount} asset${assetCount === 1 ? "" : "s"} assigned to you.`
          : "View the equipment currently assigned to you.",
      icon: LaptopIcon,
      permission: "module:it",
      count: assetCount,
    },
    {
      href: "/it/my-offboarding",
      label: "Resignation / Offboarding",
      description: "Leaving the company? Let IT know so they can prepare.",
      icon: LogoutIcon,
      permission: "module:it",
    },
    {
      href: "/hr/dashboard",
      label: "HR Management",
      description: "Manage HR operations and employee support.",
      icon: BuildingIcon,
      permission: "module:hr",
    },
    {
      href: "/admin/users",
      label: "Administration",
      description: "Manage users, roles, and permissions.",
      icon: KeyIcon,
      permission: "route:/admin/users",
    },
  ].filter((link) => !link.permission || granted.has(link.permission));

  const firstName = displayName.split(" ")[0] || displayName;

  return (
    <div className="py-6">
      <PageHeader
        title={`Welcome, ${firstName}`}
        description="Here's quick access to what you can do in the portal."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {quickLinks.map((link) => {
          const LinkIcon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="group flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
            >
              <span className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-100">
                <LinkIcon className="h-5 w-5" />
                {!!link.count && link.count > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
                    {link.count > 99 ? "99+" : link.count}
                  </span>
                )}
              </span>
              <div>
                <p className="text-base font-semibold text-slate-900">{link.label}</p>
                <p className="mt-1 text-sm text-slate-500">{link.description}</p>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="mt-12 border-t border-slate-200 pt-6">
        <p className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-slate-400">
          Part of the Fauji Food Vertical
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 opacity-70 grayscale">
          {[
            { src: "/logos/ffl-logo-blue.jpg", alt: "Fauji Foods Limited" },
            { src: "/logos/fresh-n-freeze-logo.png", alt: "Fauji Fresh n Freeze" },
            { src: "/logos/fauji-cereals-logo.png", alt: "Fauji Cereals" },
            { src: "/logos/nurpur-logo.png", alt: "Nurpur" },
            { src: "/logos/opa-logo.png", alt: "Opa!" },
          ].map((brand) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={brand.alt} src={brand.src} alt={brand.alt} className="h-6 w-auto object-contain" />
          ))}
        </div>
      </div>
    </div>
  );
}
