"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { OptimisticToggle } from "@/components/optimistic-toggle";
import { IconButton, IconLink } from "@/components/icon-button";
import { MailIcon, PencilIcon, TrashIcon } from "@/components/icons";
import { getInitials } from "@/lib/format/initials";
import type { UserStatus } from "@/types/database";
import { resendInviteEmail, revokeInvitation, setUserStatus } from "./actions";
import { DeleteUserButton } from "./delete-user-button";

export type UserRow = {
  id: string;
  name: string | null;
  email: string | null;
  roleId: string | null;
  roleName: string | null;
  designation: string | null;
  department: string | null;
  employeeCode: string | null;
  status: UserStatus;
  lastLogin: string | null;
  // Open asset assignments (Fixed Assets).
  assetsHeld: number;
};

export type InviteRow = {
  email: string;
  name: string | null;
  roleName: string | null;
  invitedAt: string;
  onboardingId: string | null;
  onboardingNumber: string | null;
};

const STATUS_FILTERS: { key: "all" | UserStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "Active", label: "Active" },
  { key: "Inactive", label: "Inactive" },
  { key: "Suspended", label: "Suspended" },
];

// A fixed time zone, so the server render and the browser print the same text.
function shortDate(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Karachi",
  });
}

const AVATAR_TONES = [
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
];
function avatarTone(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function Avatar({ name, seed, muted }: { name: string; seed: string; muted?: boolean }) {
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
        muted ? "bg-slate-100 text-slate-400" : avatarTone(seed)
      }`}
    >
      {getInitials(name)}
    </span>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden="true"
      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase();

// The User Management list: Users and Pending invites as two tabs, searched as you type (name,
// email, designation, department, employee ID, role), filtered by role and status in the browser
// with no reload. Edit / delete / status still go through the same server actions.
export function UsersDirectory({
  users,
  invites,
  roles,
  initialTab,
}: {
  users: UserRow[];
  invites: InviteRow[];
  roles: { id: string; name: string }[];
  initialTab: "users" | "invites";
}) {
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState("");
  const [roleId, setRoleId] = useState("");
  const [status, setStatus] = useState<"all" | UserStatus>("all");

  const terms = norm(query).split(/\s+/).filter(Boolean);
  const matches = (fields: (string | null)[]) => {
    const hay = fields.map(norm).join(" ");
    return terms.every((t) => hay.includes(t));
  };

  const shownUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          (!roleId || u.roleId === roleId) &&
          (status === "all" || u.status === status) &&
          matches([u.name, u.email, u.designation, u.department, u.employeeCode, u.roleName]),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, roleId, status, query],
  );
  const shownInvites = useMemo(
    () => invites.filter((i) => matches([i.name, i.email, i.roleName, i.onboardingNumber])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invites, query],
  );

  const statusCount = (key: "all" | UserStatus) =>
    users.filter((u) => (!roleId || u.roleId === roleId) && (key === "all" || u.status === key)).length;
  const filtered = Boolean(query || roleId || status !== "all");

  const tabClass = (active: boolean) =>
    `relative -mb-px flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
      active ? "border-blue-600 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"
    }`;
  const countClass = (active: boolean) =>
    `rounded-full px-2 py-0.5 text-xs ${active ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`;

  return (
    <div>
      {/* Tabs */}
      <div className="mb-5 flex gap-6 border-b border-slate-200">
        <button type="button" onClick={() => setTab("users")} className={tabClass(tab === "users")}>
          Users <span className={countClass(tab === "users")}>{users.length}</span>
        </button>
        <button type="button" onClick={() => setTab("invites")} className={tabClass(tab === "invites")}>
          Pending invites <span className={countClass(tab === "invites")}>{invites.length}</span>
        </button>
      </div>

      {/* Search + filters, one row */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              tab === "users"
                ? "Search by name, email, designation, department or employee ID…"
                : "Search invites by name, email or role…"
            }
            aria-label="Search users"
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        {tab === "users" && (
          <>
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              aria-label="Filter by role"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All roles</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <div role="group" aria-label="Filter by status" className="inline-flex shrink-0 rounded-lg bg-slate-100 p-1">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStatus(s.key)}
                  aria-pressed={status === s.key}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    status === s.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {s.label}
                  <span className="ml-1 text-xs text-slate-400">{statusCount(s.key)}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {tab === "users" ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-xs font-medium text-slate-400">
                <tr>
                  <th className="px-5 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Designation</th>
                  <th className="px-4 py-3 font-medium">Assets</th>
                  <th className="px-4 py-3 font-medium">Last sign-in</th>
                  <th className="px-4 py-3 font-medium">Active</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shownUsers.map((u) => {
                  const display = u.name ?? u.email ?? "—";
                  const inactive = u.status !== "Active";
                  return (
                    <tr key={u.id} className="group transition-colors hover:bg-slate-50/70">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={display} seed={u.id} muted={inactive} />
                          <div className="min-w-0">
                            <p className={`truncate font-medium ${inactive ? "text-slate-400" : "text-slate-900"}`}>
                              {display}
                            </p>
                            {u.email && u.email !== display && (
                              <p className="truncate text-xs text-slate-500">{u.email}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {u.roleName ? (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                            {u.roleName}
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                            No role yet
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-700">{u.designation ?? "—"}</p>
                        {u.department && <p className="text-xs text-slate-400">{u.department}</p>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {u.assetsHeld > 0 ? (
                          <Link
                            href={`/it/inventory?holder=${u.id}`}
                            title={`See the ${u.assetsHeld} asset${u.assetsHeld === 1 ? "" : "s"} ${display} holds`}
                            className={`rounded-full px-2.5 py-1 text-xs font-medium hover:underline ${
                              inactive ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-700"
                            }`}
                          >
                            {u.assetsHeld} held{inactive ? ": not returned" : ""}
                          </Link>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{shortDate(u.lastLogin)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <OptimisticToggle
                            pressed={u.status === "Active"}
                            confirmOff={
                              u.assetsHeld > 0
                                ? `${display} still holds ${u.assetsHeld} IT asset${u.assetsHeld === 1 ? "" : "s"}. Deactivate anyway? Record the return in Fixed Assets (or through offboarding) so they don't stay on their name.`
                                : undefined
                            }
                            label={u.status === "Active" ? `Deactivate ${display}` : `Reactivate ${display}`}
                            action={setUserStatus.bind(null, u.id, u.status === "Active" ? "Inactive" : "Active")}
                          />
                          {u.status === "Suspended" && <span className="text-xs text-amber-700">Suspended</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <IconLink
                            href={`/admin/users?edit=${encodeURIComponent(u.email ?? "")}`}
                            icon={<PencilIcon className="h-4 w-4" />}
                            label={`Edit ${display}`}
                            tone="primary"
                          />
                          <DeleteUserButton
                            personId={u.id}
                            confirmMessage={`Permanently delete ${display}? This deletes their account and ALL associated data (tickets, messages, assets, onboarding records — including ones owned by other people but assigned to or touched by them). This cannot be undone.`}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {shownUsers.length === 0 ? (
            <EmptyState
              title={filtered ? "No users match" : "No users yet"}
              hint={filtered ? "Try another name, role or status." : "Add the first user to get started."}
              onClear={
                filtered
                  ? () => {
                      setQuery("");
                      setRoleId("");
                      setStatus("all");
                    }
                  : undefined
              }
            />
          ) : (
            <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-400">
              {shownUsers.length === users.length
                ? `${users.length} user${users.length === 1 ? "" : "s"}`
                : `Showing ${shownUsers.length} of ${users.length} users`}
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {shownInvites.length === 0 ? (
            <EmptyState
              title={query ? "No invites match" : "No pending invites"}
              hint={query ? "Try another name or email." : "Invites appear here until the person first signs in."}
              onClear={query ? () => setQuery("") : undefined}
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {shownInvites.map((i) => {
                const display = i.name ?? i.email;
                return (
                  <li key={i.email} className="group flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-slate-50/70">
                    <Avatar name={display} seed={i.email} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                        <span className="truncate">{display}</span>
                        {i.onboardingId && (
                          <Link
                            href={`/it/onboarding/${i.onboardingId}`}
                            className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:underline"
                          >
                            Onboarding {i.onboardingNumber ?? ""}
                          </Link>
                        )}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {i.email} · {i.roleName ?? "—"} · invited {shortDate(i.invitedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <form action={resendInviteEmail.bind(null, i.email)}>
                        <IconButton icon={<MailIcon className="h-4 w-4" />} label="Resend invite email" tone="primary" />
                      </form>
                      <IconLink
                        href={`/admin/users?edit=${encodeURIComponent(i.email)}&tab=invites`}
                        icon={<PencilIcon className="h-4 w-4" />}
                        label="Edit invite"
                      />
                      <form action={revokeInvitation.bind(null, i.email)}>
                        <IconButton icon={<TrashIcon className="h-4 w-4" />} label="Revoke invite" tone="danger" />
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ title, hint, onClear }: { title: string; hint: string; onClear?: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
      </span>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{hint}</p>
      {onClear && (
        <button type="button" onClick={onClear} className="mt-3 text-sm font-medium text-blue-700 hover:underline">
          Clear search and filters
        </button>
      )}
    </div>
  );
}
