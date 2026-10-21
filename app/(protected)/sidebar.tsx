"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/lib/auth/sign-out";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";
import {
  HomeIcon,
  UserIcon,
  KeyIcon,
  BuildingIcon,
  ChevronDownIcon,
  LogoutIcon,
  TicketIcon,
  HelpCircleIcon,
} from "@/components/icons";

type IconComponent = (props: { className?: string }) => React.ReactElement;

// `permission` is a key from the `permissions` table (lib/auth/route-permissions.ts is the
// canonical map of route -> required key). Omit it for something every signed-in person should
// see regardless of role — everything else is shown only if the viewer's resolved permission set
// (computed in app/(protected)/current-user.ts, keyed off role_permissions, never a role
// *name*) actually contains it, so a brand-new custom role sees exactly what it was granted.
type NavChild = { href: string; label: string; permission?: string };
type NavLeaf = { type: "link"; href: string; label: string; icon: IconComponent; permission?: string };
type NavGroup = {
  type: "group";
  label: string;
  icon: IconComponent;
  children: NavChild[];
};
type NavEntry = NavLeaf | NavGroup;

// Collapsed = icon-only rail; hovering the rail expands it — pushing the main content over,
// same as the sidebar's own width transition — and moving the pointer away collapses it back.
// Small open/close delays smooth out brief graze-past mouse movement.
const EXPAND_DELAY_MS = 100;
const COLLAPSE_DELAY_MS = 200;

export function Sidebar({
  permissions,
  homePath,
}: {
  permissions: string[];
  homePath: string;
}) {
  const granted = new Set(permissions);
  const has = (permission?: string) => !permission || granted.has(permission);
  const pathname = usePathname();
  const [expandedByHover, setExpandedByHover] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function handleMouseEnter() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setExpandedByHover(true), EXPAND_DELAY_MS);
  }

  function handleMouseLeave() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setExpandedByHover(false), COLLAPSE_DELAY_MS);
  }

  const collapsed = !expandedByHover;

  const allBaseItems: NavLeaf[] = [
    { type: "link", href: homePath, label: "Home", icon: HomeIcon },
    { type: "link", href: "/profile", label: "My Profile", icon: UserIcon },
    { type: "link", href: "/requests", label: "My Requests", icon: TicketIcon },
    {
      type: "link",
      href: "/hr/tickets",
      label: "HR Tickets",
      icon: TicketIcon,
      permission: "module:hr",
    },
    {
      type: "link",
      href: "/it/my-tickets",
      label: "IT Tickets",
      icon: TicketIcon,
      permission: "module:it",
    },
    {
      type: "link",
      href: "/it/my-assets",
      label: "My Assets",
      icon: TicketIcon,
      permission: "module:it",
    },
    { type: "link", href: "/feedback", label: "Anonymous Feedback", icon: HelpCircleIcon },
  ];
  const baseItems: NavEntry[] = allBaseItems.filter((entry) => has(entry.permission));

  // Every module's nav section lists its OWN children with their own required permission
  // (matching lib/auth/route-permissions.ts) — no role name anywhere. A group with zero visible
  // children (nothing in it granted) renders nothing at all, so a custom role sees exactly the
  // modules/screens it was actually given, nothing more, nothing hardcoded by role.
  const allModuleSections: NavGroup[] = [
    {
      type: "group",
      label: "HR Management",
      icon: BuildingIcon,
      children: [
        { href: "/hr/dashboard", label: "Dashboard", permission: "module:hr" },
        { href: "/hr/feedback", label: "Ticket Queue", permission: "hr.tickets.read" },
        {
          href: "/hr/feedback/anonymous",
          label: "Anonymous Feedback",
          permission: "hr.anonymous_feedback.read",
        },
        {
          href: "/hr/admin/categories",
          label: "Ticket Categories",
          permission: "hr.categories.update",
        },
        {
          href: "/hr/admin/roles",
          label: "Role Permissions",
          permission: "hr.manage_role_permissions",
        },
      ],
    },
    {
      type: "group",
      label: "IT Management",
      icon: BuildingIcon,
      children: [
        { href: "/it/dashboard", label: "Dashboard", permission: "it.tickets.read" },
        // Service management track (Javaria)
        { href: "/it/tickets", label: "Ticket Queue", permission: "it.tickets.read" },
        {
          href: "/it/onboarding",
          label: "Onboarding / Offboarding",
          permission: "it.onboarding.read",
        },
        { href: "/it/reports", label: "Reports", permission: "it.tickets.read" },
        {
          href: "/it/settings/tickets",
          label: "Ticket Settings",
          permission: "it.ticket_settings.update",
        },
        {
          href: "/it/settings/sites",
          label: "Sites & IT Staff",
          permission: "it.ticket_settings.update",
        },
        { href: "/it/settings/owners", label: "Category Owners", permission: "it.tickets.read" },
        {
          href: "/it/admin/roles",
          label: "IT Roles & Permissions",
          permission: "it.manage_role_permissions",
        },
        // Inventory track (Talha)
        { href: "/it/inventory", label: "Asset Register", permission: "it.assets.read" },
        { href: "/it/inventory/maintenance", label: "Repair Log", permission: "it.assets.read" },
        {
          href: "/it/inventory/settings",
          label: "Inventory Settings",
          permission: "it.inventory_settings.update",
        },
        // (IT Roles & Permissions is listed once, above — shared by both IT tracks.)
      ],
    },
    {
      // Procurement track (Javaria) — 09-it-procurement-plan.md
      type: "group",
      label: "IT Procurement",
      icon: BuildingIcon,
      children: [
        { href: "/it/procurement/vendors", label: "Vendors", permission: "it.vendors.update" },
        { href: "/it/procurement/products", label: "Products", permission: "it.products.update" },
        {
          href: "/it/procurement/settings",
          label: "Procurement Settings",
          permission: "it.procurement_settings.update",
        },
      ],
    },
    {
      type: "group",
      label: "Administration",
      icon: KeyIcon,
      children: [
        { href: "/admin/users", label: "User Management", permission: "route:/admin/users" },
        { href: "/admin/roles", label: "Roles & Permissions", permission: "route:/admin/roles" },
        {
          href: "/admin/departments",
          label: "Departments",
          permission: "route:/admin/departments",
        },
        { href: "/admin/sites", label: "Sites", permission: "route:/admin/sites" },
        { href: "/admin/audit-log", label: "Audit Log", permission: "route:/admin/audit-log" },
      ],
    },
  ];
  const moduleSections: NavGroup[] = allModuleSections
    .map((group) => ({ ...group, children: group.children.filter((c) => has(c.permission)) }))
    .filter((group) => group.children.length > 0);

  const adminCentreItems: NavEntry[] = moduleSections;

  // usePathname() never includes a "#fragment" — strip it before comparing so any future
  // hash-linked nav entry still matches on its base path.
  function hrefPath(href: string) {
    return href.split("#")[0];
  }

  function isEntryActive(entry: NavEntry) {
    if (entry.type === "link") {
      const path = hrefPath(entry.href);
      return pathname === path || pathname.startsWith(`${path}/`);
    }
    return entry.children.some((child) => {
      const path = hrefPath(child.href);
      return pathname === path || pathname.startsWith(`${path}/`);
    });
  }

  const allGroupLabels = [...baseItems, ...adminCentreItems]
    .filter((entry): entry is NavGroup => entry.type === "group")
    .map((entry) => entry.label);

  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set(
        allGroupLabels.filter((label) => {
          const entry = [...baseItems, ...adminCentreItems].find(
            (e) => e.type === "group" && e.label === label,
          );
          return entry ? isEntryActive(entry) : false;
        }),
      ),
  );

  function toggleGroup(label: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function renderEntry(entry: NavEntry) {
    const active = isEntryActive(entry);
    const ItemIcon = entry.icon;

    if (entry.type === "link") {
      return (
        <Link
          key={entry.href}
          href={entry.href}
          title={collapsed ? entry.label : undefined}
          className={`flex w-fit items-center rounded-full px-3 py-2 text-sm font-medium transition-colors ${
            collapsed ? "gap-0" : "gap-3"
          } ${
            active
              ? "bg-blue-50 text-blue-700"
              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          }`}
        >
          <ItemIcon className="h-4 w-4 shrink-0" />
          <span
            className={`overflow-hidden whitespace-nowrap transition-[opacity,max-width] duration-150 ${
              collapsed ? "max-w-0 opacity-0" : "max-w-40 opacity-100"
            }`}
          >
            {entry.label}
          </span>
        </Link>
      );
    }

    // Collapsing the whole rail also closes every group visually — there's no room to show
    // children in icon-only width, and hovering back in restores whatever was open before.
    const isOpen = !collapsed && expanded.has(entry.label);
    return (
      <div key={entry.label}>
        <button
          type="button"
          onClick={() => toggleGroup(entry.label)}
          title={collapsed ? entry.label : undefined}
          className={`flex items-center rounded-full px-3 py-2 text-left text-sm font-medium transition-colors ${
            collapsed ? "w-fit gap-0" : "w-full gap-3"
          } ${
            active
              ? "bg-blue-50 text-blue-700"
              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          }`}
        >
          <ItemIcon className="h-4 w-4 shrink-0" />
          <span
            className={`overflow-hidden whitespace-nowrap transition-[opacity,max-width] duration-150 ${
              collapsed ? "max-w-0 opacity-0" : "max-w-40 flex-1 opacity-100"
            }`}
          >
            {entry.label}
          </span>
          {!collapsed && (
            <ChevronDownIcon
              className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
            />
          )}
        </button>
        {isOpen && (
          <div className="ml-6 mt-1 space-y-1 border-l border-slate-200 pl-3">
            {entry.children.map((child) => {
              const childPath = hrefPath(child.href);
              const childActive =
                pathname === childPath || pathname.startsWith(`${childPath}/`);
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  className={`block rounded-full px-3 py-1.5 text-sm transition-colors ${
                    childActive
                      ? "bg-blue-50 font-medium text-blue-700"
                      : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  {child.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`flex h-screen shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-slate-200 bg-white transition-[width] duration-200 ease-in-out ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      <div className="flex w-fit items-center gap-2 px-3 py-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logos/ffl-logo-blue.jpg"
          alt="Fauji Foods Limited"
          className="h-8 w-8 shrink-0 rounded-md object-contain"
        />
        <div
          className={`overflow-hidden whitespace-nowrap transition-opacity duration-150 ${
            collapsed ? "opacity-0" : "opacity-100"
          }`}
        >
          <p className="text-base font-bold text-slate-900">{APP_NAME}</p>
          <p className="text-xs text-slate-500">{APP_TAGLINE}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {baseItems.map(renderEntry)}

        {adminCentreItems.length > 0 && (
          <>
            <p
              className={`mb-1 mt-4 overflow-hidden whitespace-nowrap px-3 text-xs font-semibold uppercase tracking-wide text-slate-400 transition-opacity duration-150 ${
                collapsed ? "opacity-0" : "opacity-100"
              }`}
            >
              Admin Centre
            </p>
            {adminCentreItems.map(renderEntry)}
          </>
        )}
      </nav>

      <div className="space-y-1 border-t border-slate-200 px-3 py-4">
        <Link
          href="/profile"
          title={collapsed ? "Account" : undefined}
          className={`flex w-fit items-center rounded-full px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 ${
            collapsed ? "gap-0" : "gap-3"
          }`}
        >
          <UserIcon className="h-4 w-4 shrink-0" />
          <span
            className={`overflow-hidden whitespace-nowrap transition-[opacity,max-width] duration-150 ${
              collapsed ? "max-w-0 opacity-0" : "max-w-40 opacity-100"
            }`}
          >
            Account
          </span>
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            title={collapsed ? "Logout" : undefined}
            className={`flex w-fit items-center rounded-full px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 ${
              collapsed ? "gap-0" : "gap-3"
            }`}
          >
            <LogoutIcon className="h-4 w-4 shrink-0" />
            <span
              className={`overflow-hidden whitespace-nowrap transition-[opacity,max-width] duration-150 ${
                collapsed ? "max-w-0 opacity-0" : "max-w-40 opacity-100"
              }`}
            >
              Logout
            </span>
          </button>
        </form>
      </div>
    </aside>
  );
}
