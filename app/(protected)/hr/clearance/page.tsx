import Link from "next/link";
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
} from "../resignations/clearance-view";
import { loadSignerSetup, mySlotsForCase, myScopes } from "./signer-work";

const errorBox = "mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700";
const card = "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm";
const th = "px-4 py-2";

// The signer inbox: the parts (slots) this person signs on cases now In Clearance, and the parts
// they already signed. See signer-work.ts for how "my slots" are worked out without a new function.
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
    departmentIds.length ? `department_id.in.(${departmentIds.join(",")})` : null,
  ]
    .filter(Boolean)
    .join(",");

  const [casesResult, signedResult] = await Promise.all([
    personId && scopeFilter
      ? hr
          .from("clearance_cases")
          .select(
            "id, case_number, employee_name, employee_code, designation, last_working_date, site_id, department_id",
          )
          .eq("status", "In Clearance")
          .neq("person_id", personId)
          .or(scopeFilter)
          .order("last_working_date")
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

  const cases = casesResult.data ?? [];
  const caseIds = cases.map((c) => c.id);
  const [signoffsResult, responsesResult, linesResult, skipsResult] = caseIds.length
    ? await Promise.all([
        hr.from("clearance_signoffs").select("case_id, slot_key").in("case_id", caseIds),
        // RLS returns only the answers of the parts I sign.
        hr.from("clearance_responses").select("case_id, line_id, outcome").in("case_id", caseIds),
        hr
          .from("clearance_lines")
          .select("id, slot_key")
          .eq("is_active", true)
          .is("auto_from_form", null),
        hr.from("clearance_skips").select("case_id, slot_key").in("case_id", caseIds),
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

  const signed = new Set((signoffsResult.data ?? []).map((s) => `${s.case_id}:${s.slot_key}`));
  // A part skipped for one request needs no signature: not waiting, and HR does not wait for it.
  const skipped = new Set((skipsResult.data ?? []).map((s) => `${s.case_id}:${s.slot_key}`));
  const done = (key: string) => signed.has(key) || skipped.has(key);
  const lineIdsBySlot = new Map<string, string[]>();
  for (const l of linesResult.data ?? []) {
    lineIdsBySlot.set(l.slot_key, [...(lineIdsBySlot.get(l.slot_key) ?? []), l.id]);
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
            ? setup.slots.filter((o) => o.slot_key !== "hr" && !done(`${c.id}:${o.slot_key}`))
                .length
            : 0;
        return {
          key: `${c.id}:${s.slot_key}`,
          c,
          slot: s,
          answeredCount: lineIds.filter((id) => answered.has(`${c.id}:${id}`)).length,
          lineCount: lineIds.length,
          othersWaiting,
        };
      }),
  );

  const slotLabel = new Map(setup.slots.map((s) => [s.slot_key, cleanSlotLabel(s.label)]));
  const signedByMe = signedResult.data ?? [];
  const today = karachiToday();

  return (
    <div className="py-6">
      <PageHeader
        title="Clearance to sign"
        description="Your parts of the offboarding clearance forms: fill them in and sign."
      />

      {loadError && <p className={errorBox}>Could not load everything. Please try again later.</p>}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Waiting for you
      </h2>
      {waiting.length === 0 ? (
        <div className={`${card} mb-8 p-8 text-center text-sm text-slate-400`}>
          Nothing is waiting for your signature.
        </div>
      ) : (
        <div className={`${card} mb-8 overflow-x-auto`}>
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
                      {[w.c.employee_code, w.c.designation].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                    {formatDay(w.c.last_working_date)}
                    <p className="text-xs text-slate-500">
                      {daysLeftText(w.c.last_working_date, today)}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{cleanSlotLabel(w.slot.label)}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {w.lineCount > 0 ? `${w.answeredCount} of ${w.lineCount} lines answered` : "Sign only"}
                    {w.othersWaiting > 0 && (
                      <p className="text-xs text-amber-700">
                        Can sign after the others ({w.othersWaiting} waiting)
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/hr/clearance/${w.c.id}/${w.slot.slot_key}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Signed by you
      </h2>
      {signedByMe.length === 0 ? (
        <div className={`${card} p-8 text-center text-sm text-slate-400`}>
          You haven&apos;t signed anything yet.
        </div>
      ) : (
        <div className={`${card} overflow-x-auto`}>
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
                    <p className="text-slate-900">{s.clearance_cases?.employee_name ?? "—"}</p>
                    {s.clearance_cases?.employee_code && (
                      <p className="text-xs text-slate-500">{s.clearance_cases.employee_code}</p>
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
      )}
    </div>
  );
}
