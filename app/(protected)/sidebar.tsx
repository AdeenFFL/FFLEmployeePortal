"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/lib/auth/sign-out";
import {
  HomeIcon,
  UserIcon,
  KeyIcon,
  BuildingIcon,
  MapPinIcon,
  ChevronDownIcon,
  LogoutIcon,
  TicketIcon,
} from "@/components/icons";

type IconComponent = (props: { className?: string }) => React.ReactElement;

type NavLeaf = { type: "link"; href: string; label: string; icon: IconComponent };
type NavGroup = {
  type: "group";
  label: string;
  icon: IconComponent;
  children: { href: string; label: string }[];
};
type NavEntry = NavLeaf | NavGroup;

export function Sidebar({
  roleName,
  homePath,
}: {
  roleName: string | null;
  homePath: string;
}) {
  const pathname = usePathname();

  const baseItems: NavEntry[] = [
    { type: "link", href: homePath, label: "Home", icon: HomeIcon },
    { type: "link", href: "/profile", label: "My Profile", icon: UserIcon },
    { type: "link", href: "/requests", label: "My Requests", icon: TicketIcon },
  ];

  // Every signed-in person is an employee first (they get baseItems above); "Admin Centre" is
  // appended on top for whichever elevated role they also happen to have. Display-only —
  // proxy.ts's permission checks already gate every route regardless of what's linked here.
  const adminCentreItems: NavEntry[] = [];
  if (roleName === "HR") {
    adminCentreItems.push({
      type: "link",
      href: "/hr/dashboard",
      label: "HR Management",
      icon: BuildingIcon,
    });
  }
  if (roleName === "IT") {
    adminCentreItems.push({
      type: "link",
      href: "/it/dashboard",
      label: "IT Management",
      icon: MapPinIcon,
    });
  }
  if (roleName === "Admin") {
    adminCentreItems.push({
      type: "group",
      label: "Administration",
      icon: KeyIcon,
      children: [
        { href: "/admin/users", label: "User Management" },
        { href: "/admin/roles", label: "Roles & Permissions" },
        { href: "/admin/permission-groups", label: "Permission Groups" },
        { href: "/admin/departments", label: "Departments" },
        { href: "/admin/sites", label: "Sites" },
        { href: "/admin/audit-log", label: "Audit Log" },
      ],
    });
  }

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
          className={`flex items-center gap-3 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
            active
              ? "bg-blue-50 text-blue-700"
              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          }`}
        >
          <ItemIcon className="h-4 w-4" />
          {entry.label}
        </Link>
      );
    }

    const isOpen = expanded.has(entry.label);
    return (
      <div key={entry.label}>
        <button
          type="button"
          onClick={() => toggleGroup(entry.label)}
          className={`flex w-full items-center gap-3 rounded-full px-3 py-2 text-left text-sm font-medium transition-colors ${
            active
              ? "bg-blue-50 text-blue-700"
              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          }`}
        >
          <ItemIcon className="h-4 w-4" />
          <span className="flex-1">{entry.label}</span>
          <ChevronDownIcon
            className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
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
    <aside className="flex h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2 px-5 py-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logos/fauji-foods.jpg"
          alt="Fauji Foods"
          className="h-8 w-8 shrink-0 rounded-md object-contain"
        />
        <div>
          <p className="text-base font-bold text-slate-900">Employee Portal</p>
          <p className="text-xs text-slate-500">Fauji Foods</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {baseItems.map(renderEntry)}

        {adminCentreItems.length > 0 && (
          <>
            <p className="mb-1 mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Admin Centre
            </p>
            {adminCentreItems.map(renderEntry)}
          </>
        )}
      </nav>

      <div className="space-y-1 border-t border-slate-200 px-3 py-4">
        <Link
          href="/profile"
          className="flex items-center gap-3 rounded-full px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        >
          <UserIcon className="h-4 w-4" />
          Account
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-full px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          >
            <LogoutIcon className="h-4 w-4" />
            Logout
          </button>
        </form>
      </div>
    </aside>
  );
}
