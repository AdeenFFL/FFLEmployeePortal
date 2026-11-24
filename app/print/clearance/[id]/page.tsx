import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDay, formatTimestamp } from "../../../(protected)/hr/clearance-requests/clearance-view";
import { SignatureName } from "../../../(protected)/hr/clearance/signature-name";
import { PrintButton } from "./print-button";

// The clearance as the company's paper form "Final Settlement (Separation Check List)", three A4
// pages, filled from the system. Outside the (protected) layout on purpose: no sidebar or menu,
// on screen or on paper. Only hr.clearance.read_all (route-permissions.ts, checked again here).
// Read-only: nothing on this page changes data. Parts not signed yet keep empty boxes and lines,
// so they can still be signed by hand.

type Outcome = "Yes" | "No" | "N/A";
type Line = {
  id: string;
  line_key: string;
  form_key: string;
  slot_key: string;
  description: string;
  sort_order: number;
  is_active: boolean;
};
type Signoff = { slot_key: string; signer_name: string; signer_designation: string | null; signed_at: string };

// Page-one lines that have their own box on page 1 of the paper form.
const PAGE1_LINES = {
  admin: "p1.admin",
  accounts: "p1.accounts",
  it: "p1.it",
  handingOver: "p1.handing_over",
  dataReceived: "p1.data_received",
  emailForward: "p1.email_forward",
};
const PAGE1_KEYS = new Set(Object.values(PAGE1_LINES));
const TOTAL_PAGES = 3;

const cell = "border border-black px-2 py-1 align-top";
const headCell = "border border-black bg-black px-2 py-1 text-left font-semibold text-white";
const tickCell = `${cell} w-16 text-center`;

export default async function ClearancePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("has_permission", {
    p_permission_key: "hr.clearance.read_all",
  });
  if (!allowed) notFound();

  const hr = supabase.schema("hr");
  const [{ data: c }, linesResult, responsesResult, signoffsResult, skipsResult, unitsResult, detailsResult] =
    await Promise.all([
      hr.from("clearance_cases").select("*").eq("id", id).maybeSingle(),
      hr
        .from("clearance_lines")
        .select("id, line_key, form_key, slot_key, description, sort_order, is_active")
        .order("sort_order"),
      hr.from("clearance_responses").select("line_id, outcome, remarks").eq("case_id", id),
      hr
        .from("clearance_signoffs")
        .select("slot_key, signer_name, signer_designation, signed_at")
        .eq("case_id", id),
      hr.from("clearance_skips").select("slot_key, reason").eq("case_id", id),
      hr.rpc("clearance_list_units"),
      hr
        .from("clearance_hr_details")
        .select("resignation_letter_date, unserved_notice_days, annual_leave_balance, other_outstanding, handing_over_to, email_forward_to")
        .eq("case_id", id)
        .maybeSingle(),
    ]);
  if (!c) notFound();

  const loadError =
    linesResult.error ?? responsesResult.error ?? signoffsResult.error ?? skipsResult.error ?? detailsResult.error;

  const responseByLine = new Map((responsesResult.data ?? []).map((r) => [r.line_id, r]));
  // Active lines, plus any retired line that was already answered on this case.
  const lines = ((linesResult.data ?? []) as Line[]).filter(
    (l) => l.is_active || responseByLine.get(l.id)?.outcome,
  );
  const lineByKey = new Map(lines.map((l) => [l.line_key, l]));
  const signoffBySlot = new Map(((signoffsResult.data ?? []) as Signoff[]).map((s) => [s.slot_key, s]));
  const skipBySlot = new Map((skipsResult.data ?? []).map((s) => [s.slot_key, s.reason]));
  const departmentName = c.department_id
    ? ((unitsResult.data ?? []).find((u) => u.id === c.department_id)?.name ?? null)
    : null;
  const details = detailsResult.data;

  const outcomeOf = (key: string): Outcome | null => {
    const line = lineByKey.get(key);
    return line ? ((responseByLine.get(line.id)?.outcome as Outcome | null) ?? null) : null;
  };
  const remarksOf = (key: string) => {
    const line = lineByKey.get(key);
    return line ? (responseByLine.get(line.id)?.remarks ?? null) : null;
  };
  const formLines = (formKey: string) =>
    lines.filter((l) => l.form_key === formKey && !(formKey === "page_one" && PAGE1_KEYS.has(l.line_key)));

  // Page 1 checklist box of one form: only a tick once every part of it is cleared (signed, or
  // skipped), "N/A" when all its parts were skipped, else empty. The signatures themselves are on
  // pages 2 and 3.
  const formStatus = (formKey: string) => {
    const slots = slotsOfForm(formKey);
    if (slots.length === 0) return "";
    const allSkipped = slots.every((s) => !signoffBySlot.has(s) && skipBySlot.has(s));
    if (allSkipped) return "N/A";
    return slots.every((s) => signoffBySlot.has(s) || skipBySlot.has(s)) ? "✓" : "";
  };
  const slotsOfForm = (formKey: string) =>
    [...new Set(lines.filter((l) => l.form_key === formKey).map((l) => l.slot_key))];

  const formHasLines = (formKey: string) => formLines(formKey).length > 0;
  const itemValue = (v: string | number | null | undefined, unit?: string) =>
    v === null || v === undefined || v === "" ? "" : unit ? `${Number(v)} ${unit}` : String(v);

  return (
    <div className="flex flex-col items-center gap-6 bg-slate-100 py-6 print:block print:bg-white print:py-0">
      <style>{`@page { size: A4; margin: 10mm; }`}</style>

      <div className="flex w-[210mm] max-w-full flex-wrap items-center justify-between gap-3 px-4 print:hidden">
        <Link href={`/hr/clearance-requests/${c.id}`} className="text-sm text-blue-700 hover:underline">
          ← Back to {c.case_number}
        </Link>
        <PrintButton />
      </div>
      {loadError && (
        <p className="w-[210mm] max-w-full rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 print:hidden">
          Some parts could not be loaded. Please reload the page before printing.
        </p>
      )}

      {/* ---------------- Page 1 ---------------- */}
      <Sheet page={1}>
        <Section title="EMPLOYEE DETAILS:">
          <KeyValueTable
            rows={[
              ["Employee ID", c.employee_code ?? ""],
              ["Employee Name", c.employee_name],
              ["Designation", c.designation ?? ""],
              ["Department", departmentName ?? ""],
              ["Reporting manager/HOD", c.reporting_manager_name ?? ""],
            ]}
          />
        </Section>
        <Section title="RESIGNATION DETAILS:">
          <KeyValueTable
            rows={[
              ["Resignation submission date", details?.resignation_letter_date ? formatDay(details.resignation_letter_date) : ""],
              ["Date of Joining", c.date_of_joining ? formatDay(c.date_of_joining) : ""],
              ["Last working date", formatDay(c.last_working_date)],
              ["Un-served notice period (days)", itemValue(details?.unserved_notice_days)],
            ]}
          />
        </Section>
        <Section title="SALARY & LEAVES DETAILS:">
          <KeyValueTable
            rows={[
              ["Un-availed Annual Leaves Balance", itemValue(details?.annual_leave_balance, "days")],
              ["Any other outstanding amount (DES / Medical etc.)", details?.other_outstanding ?? ""],
            ]}
          />
        </Section>
        <Section title="CHECKLIST:">
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              <tr>
                <td className={`${cell} w-1/2`}>Administration/Sales Operation/Area Office</td>
                <td className={`${cell} font-semibold`}>{formStatus("admin")}</td>
              </tr>
              <tr>
                <td className={cell}>Finance</td>
                <td className={`${cell} font-semibold`}>{formStatus("accounts")}</td>
              </tr>
              <tr>
                <td className={cell}>Information Technology</td>
                <td className={`${cell} font-semibold`}>{formStatus("it")}</td>
              </tr>
              <tr className="bg-amber-50 print:bg-amber-50">
                <td className={cell}>Handing over done to</td>
                <td className={cell}>Mr. / Ms.: {details?.handing_over_to ?? remarksOf(PAGE1_LINES.handingOver) ?? ""}</td>
              </tr>
              <tr className="bg-amber-50">
                <td className={cell}>Complete Data received by Line Manager</td>
                <td className={cell}>
                  Yes <Blank mark={outcomeOf(PAGE1_LINES.dataReceived) === "Yes"} /> &nbsp;&nbsp; No{" "}
                  <Blank mark={outcomeOf(PAGE1_LINES.dataReceived) === "No"} />
                </td>
              </tr>
              <tr className="bg-amber-50">
                <td className={cell}>Email forwarding to:</td>
                <td className={cell}>{details?.email_forward_to ?? remarksOf(PAGE1_LINES.emailForward) ?? ""}</td>
              </tr>
            </tbody>
          </table>
        </Section>
        <p className="mt-4 text-[13px]">
          We hereby confirm that the above details are complete and accurate. Outstanding dues, including
          un-adjusted advances and loans will be adjusted from final settlement.
        </p>
        <div className="mt-10 grid grid-cols-4 gap-4 text-[12px]">
          <SignatureLine
            role="Outgoing Employee"
            name={c.employee_name}
            signed={Boolean(c.employee_signed_at)}
            note={c.employee_signed_at ? `Signed electronically ${formatTimestamp(c.employee_signed_at)}` : null}
          />
          <SignatureLine
            role="Line Manager"
            name={c.reporting_manager_name}
            signed={Boolean(c.data_received_confirmed_at)}
            note={
              c.data_received_confirmed_at
                ? `Data received confirmed ${formatTimestamp(c.data_received_confirmed_at)}`
                : null
            }
          />
          <SignatureLine role="Head of Department" signoff={signoffBySlot.get("dept_head")} skip={skipBySlot.get("dept_head")} />
          <SignatureLine role="HRBP" signoff={signoffBySlot.get("hr")} skip={skipBySlot.get("hr")} />
        </div>
      </Sheet>

      {/* ---------------- Page 2 ---------------- */}
      <Sheet page={2}>
        <FormTable
          number="(1)"
          title="HUMAN RESOURCE:"
          columns={["Yes", "No"]}
          lines={formLines("page_one")}
          responseByLine={responseByLine}
          signoffBySlot={signoffBySlot}
          department="HR Department"
          departmentSlots={["hr"]}
          employeeName={c.employee_name}
          skipBySlot={skipBySlot}
        />
        {formHasLines("admin") && (
          <FormTable
            number="(2)"
            title="ADMINISTRATION:"
            columns={["Received", "Not Received", "N/A"]}
            lines={formLines("admin")}
            responseByLine={responseByLine}
            signoffBySlot={signoffBySlot}
            department="Admin Department"
            departmentSlots={slotsOfForm("admin")}
            employeeName={c.employee_name}
            skipBySlot={skipBySlot}
          />
        )}
        {formHasLines("accounts") && (
          <FormTable
            number="(2)"
            title="ACCOUNTS DEPARTMENT CHECKLIST:"
            columns={["Received", "Not Received", "N/A"]}
            lines={formLines("accounts")}
            responseByLine={responseByLine}
            signoffBySlot={signoffBySlot}
            department="Accounts Department"
            departmentSlots={slotsOfForm("accounts")}
            employeeName={c.employee_name}
            skipBySlot={skipBySlot}
          />
        )}
      </Sheet>

      {/* ---------------- Page 3 ---------------- */}
      <Sheet page={3}>
        <FormTable
          number="(3)"
          title="INFORMATION TECHNOLOGY - CHECKLIST"
          columns={["Yes", "No", "N/A"]}
          lines={formLines("it")}
          responseByLine={responseByLine}
          signoffBySlot={signoffBySlot}
          department="IT Department"
          departmentSlots={slotsOfForm("it")}
          employeeName={c.employee_name}
          skipBySlot={skipBySlot}
        />
      </Sheet>
    </div>
  );
}

// Each signing person once (the same person can be the signer of two parts, e.g. Admin and Store).
function uniqueSigners(signoffs: (Signoff | undefined)[]) {
  const seen = new Set<string>();
  return signoffs.filter((so): so is Signoff => {
    if (!so || seen.has(so.signer_name)) return false;
    seen.add(so.signer_name);
    return true;
  });
}

// Under a signature: designation and date (the name itself is drawn as the signature).
function signerSub(so: Signoff) {
  return [so.signer_designation, formatTimestamp(so.signed_at)].filter(Boolean).join(", ");
}

// A signed name with its designation and date under it.
function SignedBlock({ so }: { so: Signoff }) {
  return (
    <span className="inline-block">
      <SignatureName name={so.signer_name} className="block text-2xl leading-none" />
      <span className="block text-[10px] leading-tight text-slate-600">{signerSub(so)}</span>
    </span>
  );
}

// One A4 sheet with the form's boxed header and "Page x of 3".
function Sheet({ page, children }: { page: number; children: React.ReactNode }) {
  return (
    <section
      className="flex min-h-[297mm] w-[210mm] max-w-full flex-col bg-white px-[15mm] py-[12mm] text-black shadow print:min-h-[277mm] print:w-auto print:px-0 print:py-0 print:shadow-none"
      style={{ breakAfter: page < TOTAL_PAGES ? "page" : "auto" }}
    >
      <div className="relative mb-6 border border-black px-4 py-5 text-center">
        <p className="text-lg font-bold">Final Settlement</p>
        <p className="text-sm font-semibold">(Separation Check List)</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- printed as is, no optimisation needed */}
        <img
          src="/logos/fresh-n-freeze-logo.png"
          alt="Fauji Fresh n Freeze"
          className="absolute left-4 top-1/2 h-12 -translate-y-1/2"
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- printed as is, no optimisation needed */}
        <img src="/logos/ffl-logo-blue.jpg" alt="Fauji Foods" className="absolute right-4 top-1/2 h-12 -translate-y-1/2" />
      </div>
      <div className="flex-1">{children}</div>
      <p className="mt-6 text-right text-sm">
        Page <b>{page}</b> of <b>{TOTAL_PAGES}</b>
      </p>
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5" style={{ breakInside: "avoid" }}>
      <p className="mb-1 text-[13px] font-bold">{title}</p>
      {children}
    </div>
  );
}

function KeyValueTable({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td className={`${cell} w-1/2`}>{label}</td>
            <td className={cell}>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// "Yes ____" on page 1: a tick on the line when chosen.
function Blank({ mark }: { mark: boolean }) {
  return <span className="inline-block w-16 border-b border-black text-center">{mark ? "✓" : " "}</span>;
}

// A signature line: the signature, designation and date when signed in the system, else the name
// (or nothing) on an empty line. signed: the employee / line manager did their step in the system.
function SignatureLine({
  role,
  signoff,
  skip,
  name,
  note,
  signed,
}: {
  role: string;
  signoff?: Signoff;
  skip?: string;
  name?: string | null;
  note?: string | null;
  signed?: boolean;
}) {
  if (signoff || (signed && name)) {
    return (
      <div>
        <div className="min-h-[2.5em]">
          {signoff ? (
            <SignedBlock so={signoff} />
          ) : (
            <>
              <SignatureName name={name ?? ""} className="block text-2xl leading-none" />
              {note && <span className="block text-[10px] leading-tight text-slate-600">{note}</span>}
            </>
          )}
        </div>
        <div className="border-t border-black pt-1">{role}</div>
      </div>
    );
  }
  const text = skip ? `Skipped: ${skip}` : [name, note].filter(Boolean).join(" · ");
  return (
    <div>
      <p className="min-h-[2.5em] text-[11px] leading-tight text-slate-700">{text}</p>
      <div className="border-t border-black pt-1">{role}</div>
    </div>
  );
}

function FormTable({
  number,
  title,
  columns,
  lines,
  responseByLine,
  signoffBySlot,
  skipBySlot,
  department,
  departmentSlots,
  employeeName,
}: {
  number: string;
  title: string;
  columns: string[];
  lines: Line[];
  responseByLine: Map<string, { outcome: string | null; remarks: string | null }>;
  signoffBySlot: Map<string, Signoff>;
  skipBySlot: Map<string, string>;
  department: string;
  departmentSlots: string[];
  employeeName: string;
}) {
  // Column order matches Yes / No / N/A (Received = Yes, Not Received = No).
  const outcomeForColumn = ["Yes", "No", "N/A"];
  const departmentSignoffs = uniqueSigners(departmentSlots.map((s) => signoffBySlot.get(s)));
  const departmentSkips = [...new Set(departmentSlots.flatMap((s) => (signoffBySlot.has(s) ? [] : (skipBySlot.get(s) ?? []))))];
  return (
    <div className="mb-6" style={{ breakInside: "avoid" }}>
      <p className="mb-1 text-[13px]">
        {number} <b>{title}</b>
      </p>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={headCell}>Description</th>
            {columns.map((col) => (
              <th key={col} className={`${headCell} w-16 text-center`}>
                {col}
              </th>
            ))}
            <th className={`${headCell} w-40 text-center`}>Signature</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const r = responseByLine.get(l.id);
            const so = signoffBySlot.get(l.slot_key);
            const naWithoutColumn = r?.outcome === "N/A" && !columns.includes("N/A");
            return (
              <tr key={l.id}>
                <td className={cell}>
                  {l.description}
                  {naWithoutColumn && <span className="text-[11px]"> (N/A)</span>}
                  {r?.remarks && <span className="block text-[11px] text-slate-600">{r.remarks}</span>}
                </td>
                {columns.map((col, i) => (
                  <td key={col} className={tickCell}>
                    {r?.outcome === outcomeForColumn[i] ? "✓" : ""}
                  </td>
                ))}
                {/* Who cleared this line: the signer of its part (Store lines show the Store signer). */}
                <td className={`${cell} text-[11px]`}>
                  {so ? <SignatureName name={so.signer_name} className="text-lg leading-none" /> : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-10 flex justify-between gap-6 text-[12px]">
        <div className="w-48">
          <p className="min-h-[2.5em] text-[11px] leading-tight text-slate-700">{employeeName}</p>
          <div className="border-t border-black pt-1">Outgoing Employee</div>
        </div>
        <div className="w-56 text-right">
          <p className="min-h-[2.5em] text-[11px] leading-tight text-slate-700">
            {departmentSignoffs.length > 0
              ? departmentSignoffs.map((so) => (
                  <span key={so.signer_name} className="ml-3 inline-block first:ml-0">
                    <SignedBlock so={so} />
                  </span>
                ))
              : departmentSkips.length > 0
                ? `Skipped: ${departmentSkips.join(" · ")}`
                : ""}
          </p>
          <div className="border-t border-black pt-1">{department}</div>
        </div>
      </div>
    </div>
  );
}
