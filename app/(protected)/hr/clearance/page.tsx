import Link from "next/link";
import { EmptyState } from "./empty-state";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import {
  STATUS_TONE,
  cleanSlotLabel,
  daysLeftText,
  formatDay,
  formatTimestamp,
  karachiToday,
  overdueDays,
} from "../clearance-requests/clearance-view";
import { loadSignerSetup, mySlotsForCase, myScopes } from "./signer-work";

const errorBox = "mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700";
const card =
  "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm";
const th = "px-4 py-2";

// The signer inbox: the parts (slots) this person signs on cases now In Clearance, and the parts
// they already signed. See signer-work.ts for how "my slots" are worked out without a new function.
// "Open" links as small soft pills.
const openPill =
  "inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200";

export default async function ClearanceInboxPage() {
  const supabase = await createClient();
  const hr = supabase.schema("hr");
  const { data: personId } = await supabase.rpc("current_person_id");

  const setup = personId
    ? await loadSignerSetup(supabase, personId)
    : { signers: [], slots: [], error: null };
  const { siteIds, departmentIds } = myScopes(setup.signers, setup.slots);
  const scopeFilter = [
    siteIds.length ? `site_id.in.(${siteIds.join(",")})` : null,
    departmentIds.length
      ? `department_id.in.(${departmentIds.join(",")})`
      : null,
  ]
    .filter(Boolean)
    .join(",");

  const [casesResult, signedResult] = await Promise.all([
    personId && scopeFilter
      ? hr
          .from("clearance_cases")
          .select(
            "id, case_number, employee_name, employee_code, designation, last_working_date, site_id, department_id, forwarded_at",
          )
          .eq("status", "In Clearance")
          .neq("person_id", personId)
          .or(scopeFilter)
          // Newest request first.
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    personId
      ? hr
          .from("clearance_signoffs")
          .select(
            "case_id, slot_key, signed_at, clearance_cases(case_number, employee_name, employee_code, status)",
          )
          .eq("signed_by_person_id", personId)
          .order("signed_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [], error: null }),
  ]);

  // Lines (talha_hr_0011) and asset returns (talha_hr_0012) the IT Team Lead handed to me; before
  // they are live these fail quietly.
  const [{ data: myTasks }, { data: myAssetTasks }] = personId
    ? await Promise.all([
        hr.rpc("my_clearance_tasks"),
        hr.rpc("my_clearance_asset_tasks"),
      ])
    : [{ data: [] }, { data: [] }];
  const openTaskCount =
    (myTasks ?? []).filter(
      (t) => t.case_status === "In Clearance" && !t.part_locked && !t.outcome,
    ).length +
    (myAssetTasks ?? []).filter(
      (t) => t.case_status === "In Clearance" && !t.part_locked && !t.returned,
    ).length;

  const cases = casesResult.data ?? [];
  const caseIds = cases.map((c) => c.id);
  const [signoffsResult, responsesResult, linesResult, skipsResult] =
    caseIds.length
      ? await Promise.all([
          hr
            .from("clearance_signoffs")
            .select("case_id, slot_key")
            .in("case_id", caseIds),
          // RLS returns only the answers of the parts I sign.
          hr
            .from("clearance_responses")
            .select("case_id, line_id, outcome")
            .in("case_id", caseIds),
          hr
            .from("clearance_lines")
            .select("id, slot_key")
            .eq("is_active", true)
            .is("auto_from_form", null),
          hr
            .from("clearance_skips")
            .select("case_id, slot_key")
            .in("case_id", caseIds),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];

  const loadError =
    setup.error ??
    casesResult.error ??
    signedResult.error ??
    signoffsResult.error ??
    responsesResult.error ??
    linesResult.error ??
    skipsResult.error;

  const signed = new Set(
    (signoffsResult.data ?? []).map((s) => `${s.case_id}:${s.slot_key}`),
  );
  // A part skipped for one request needs no signature: not waiting, and HR does not wait for it.
  const skipped = new Set(
    (skipsResult.data ?? []).map((s) => `${s.case_id}:${s.slot_key}`),
  );
  const done = (key: string) => signed.has(key) || skipped.has(key);
  const lineIdsBySlot = new Map<string, string[]>();
  for (const l of linesResult.data ?? []) {
    lineIdsBySlot.set(l.slot_key, [
      ...(lineIdsBySlot.get(l.slot_key) ?? []),
      l.id,
    ]);
  }
  const answered = new Set(
    (responsesResult.data ?? [])
      .filter((r) => r.outcome !== null)
      .map((r) => `${r.case_id}:${r.line_id}`),
  );

  const waiting = cases.flatMap((c) =>
    mySlotsForCase(c, setup.signers, setup.slots)
      .filter((s) => !done(`${c.id}:${s.slot_key}`))
      .map((s) => {
        const lineIds = lineIdsBySlot.get(s.slot_key) ?? [];
        const othersWaiting =
          s.slot_key === "hr"
            ? setup.slots.filter(
                (o) => o.slot_key !== "hr" && !done(`${c.id}:${o.slot_key}`),
              ).length
            : 0;
        return {
          key: `${c.id}:${s.slot_key}`,
          c,
          slot: s,
          answeredCount: lineIds.filter((id) => answered.has(`${c.id}:${id}`))
            .length,
          lineCount: lineIds.length,
          othersWaiting,
        };
      }),
  );

  const slotLabel = new Map(
    setup.slots.map((s) => [s.slot_key, cleanSlotLabel(s.label)]),
  );
  const signedByMe = signedResult.data ?? [];
  const today = karachiToday();

  return (
    <div className="py-6">
      {/* Round back button (words in the tooltip) beside the title. */}
      <div className="flex items-start gap-3">
        <Link
          href="/hr/clearance-home"
          title="Back to Clearance"
          aria-label="Back to Clearance"
          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900"
        >
          ←
        </Link>
        <PageHeader title="Clearance to sign" />
      </div>

      {openTaskCount > 0 && (
        <Link
          href="/hr/clearance/tasks"
          className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm text-blue-800 hover:bg-blue-100"
        >
          <span>
            <span className="font-medium">
              {openTaskCount} clearance task{openTaskCount === 1 ? "" : "s"}
            </span>{" "}
            assigned to you by the IT Team Lead.
          </span>
          <span className={openPill}>Open my tasks</span>
        </Link>
      )}

      {loadError && (
        <p className={errorBox}>
          Could not load everything. Please try again later.
        </p>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Waiting for you
      </h2>
      {waiting.length === 0 ? (
        <EmptyState
          icon="🎉"
          text="Nothing is waiting for your signature."
          className="mb-8"
        />
      ) : (
        <>
          {/* Phone: one small card per part (the table would scroll sideways). */}
          <ul className="mb-8 flex flex-col gap-3 md:hidden">
            {waiting.map((w) => (
              <li key={w.key} className={`${card} flex flex-col gap-2 p-4`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {w.c.employee_name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {w.c.case_number} · {cleanSlotLabel(w.slot.label)}
                    </p>
                  </div>
                  <Link
                    href={`/hr/clearance/${w.c.id}/${w.slot.slot_key}`}
                    className={openPill}
                  >
                    Open
                  </Link>
                </div>
                <p className="text-xs text-slate-600">
                  Last day {formatDay(w.c.last_working_date)} (
                  {daysLeftText(w.c.last_working_date, today)}) ·{" "}
                  {w.lineCount > 0
                    ? `${w.answeredCount}/${w.lineCount} answered`
                    : "Sign only"}
                </p>
                {w.othersWaiting === 0 &&
                  overdueDays(w.c.forwarded_at, today) !== null && (
                    <p className="text-xs font-medium text-amber-700">
                      ⏰ Overdue · {overdueDays(w.c.forwarded_at, today)} days
                    </p>
                  )}
                {w.othersWaiting > 0 && (
                  <p className="text-xs text-amber-700">
                    Can sign after the others ({w.othersWaiting} waiting)
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div className={`${card} mb-8 hidden overflow-x-auto md:block`}>
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className={th}>Request</th>
                  <th className={th}>Employee</th>
                  <th className={th}>Last working date</th>
                  <th className={th}>Your part</th>
                  <th className={th}>Progress</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {waiting.map((w) => (
                  <tr key={w.key}>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">
                      {w.c.case_number}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-900">{w.c.employee_name}</p>
                      <p className="text-xs text-slate-500">
                        {[w.c.employee_code, w.c.designation]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {formatDay(w.c.last_working_date)}
                      <p className="text-xs text-slate-500">
                        {daysLeftText(w.c.last_working_date, today)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {cleanSlotLabel(w.slot.label)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {w.lineCount > 0
                        ? `${w.answeredCount} of ${w.lineCount} lines answered`
                        : "Sign only"}
                      {w.othersWaiting === 0 &&
                        overdueDays(w.c.forwarded_at, today) !== null && (
                          <p className="text-xs font-medium text-amber-700">
                            ⏰ Overdue · {overdueDays(w.c.forwarded_at, today)}{" "}
                            days
                          </p>
                        )}
                      {w.othersWaiting > 0 && (
                        <p className="text-xs text-amber-700">
                          Can sign after the others ({w.othersWaiting} waiting)
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/hr/clearance/${w.c.id}/${w.slot.slot_key}`}
                        className={openPill}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Signed by you
      </h2>
      {signedByMe.length === 0 ? (
        <EmptyState icon="✍️" text="You haven't signed anything yet." />
      ) : (
        <>
          {/* Phone: one small card per signed part. */}
          <ul className="flex flex-col gap-3 md:hidden">
            {signedByMe.map((s) => (
              <li
                key={`${s.case_id}:${s.slot_key}`}
                className={`${card} flex items-start justify-between gap-3 p-4`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {s.clearance_cases?.employee_name ?? "—"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {s.clearance_cases?.case_number ?? "—"} ·{" "}
                    {slotLabel.get(s.slot_key) ?? s.slot_key}
                  </p>
                  <p className="text-xs text-slate-500">
                    Signed {formatTimestamp(s.signed_at)}
                  </p>
                </div>
                <Link
                  href={`/hr/clearance/${s.case_id}/${s.slot_key}`}
                  className={openPill}
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
          <div className={`${card} hidden overflow-x-auto md:block`}>
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className={th}>Request</th>
                  <th className={th}>Employee</th>
                  <th className={th}>Your part</th>
                  <th className={th}>Signed on</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {signedByMe.map((s) => (
                  <tr key={`${s.case_id}:${s.slot_key}`}>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link
                        href={`/hr/clearance/${s.case_id}/${s.slot_key}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {s.clearance_cases?.case_number ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-900">
                        {s.clearance_cases?.employee_name ?? "—"}
                      </p>
                      {s.clearance_cases?.employee_code && (
                        <p className="text-xs text-slate-500">
                          {s.clearance_cases.employee_code}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {slotLabel.get(s.slot_key) ?? s.slot_key}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {formatTimestamp(s.signed_at)}
                    </td>
                    <td className="px-4 py-3">
                      {s.clearance_cases && (
                        <StatusPill
                          label={s.clearance_cases.status}
                          tone={STATUS_TONE[s.clearance_cases.status]}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
