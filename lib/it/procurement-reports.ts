import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ItDemand, ItInvoice, ItPayment, ItReceivingRecord } from "@/types/database";
import { formatMoney } from "@/lib/it/procurement";

// PRC-09 procurement reports + dashboard figures (09-it-procurement-plan.md Phase 7). Reads go
// through RLS, so a site's IT staff see their sites' figures and all-sites / Finance see every
// site — the same scoping as the demand queue. No new database objects.

type Client = SupabaseClient<Database>;

const DAY = 24 * 3_600_000;

export const PROCUREMENT_REPORTS = {
  register: {
    title: "Demand register",
    description: "Every demand raised in the period, with approval, delivery, invoice and payment totals.",
  },
  cycle: {
    title: "Cycle time",
    description: "Days from raised to approved, ordered, fully received and paid — closed demands in the period.",
  },
  "spend-vendor": { title: "Spend by vendor", description: "Payments made in the period, by vendor." },
  "spend-department": { title: "Spend by department", description: "Payments made in the period, by department." },
  "spend-site": { title: "Spend by site", description: "Payments made in the period, by site." },
  shortfalls: {
    title: "Receiving shortfalls",
    description: "Open orders where less has been accepted than approved (as of now), with damaged items.",
  },
  finance: {
    title: "Pending at Finance",
    description: "Invoice packages with Finance and not yet fully paid (as of now), with SLA ageing.",
  },
} as const;

export type ProcurementReportKind = keyof typeof PROCUREMENT_REPORTS;

export function isProcurementReportKind(value: string | undefined): value is ProcurementReportKind {
  return Boolean(value && value in PROCUREMENT_REPORTS);
}

// Who may open the reports: site / all-sites procurement staff and Finance.
export const PROCUREMENT_REPORT_KEYS = ["it.demands.read", "it.demands.read_all", "it.payments.update"];

function days(fromIso: string | null | undefined, toIso: string | null | undefined) {
  if (!fromIso || !toIso) return null;
  return Math.max(0, (new Date(toIso).getTime() - new Date(fromIso).getTime()) / DAY);
}

function fmtDays(value: number | null) {
  return value === null ? "—" : value.toFixed(1);
}

function avg(values: (number | null)[]) {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function fmtDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

// Shared lookups (names for ids). Best-effort: a missing name prints as "—".
async function lookups(supabase: Client) {
  const [{ data: units }, { data: products }, { data: vendors }] = await Promise.all([
    supabase.schema("it").rpc("list_org_units"),
    supabase.schema("it").from("products").select("id, product_name, unit"),
    supabase.schema("it").from("vendors").select("id, vendor_name"),
  ]);
  return {
    unit: new Map((units ?? []).map((u) => [u.id, u.name])),
    product: new Map((products ?? []).map((p) => [p.id, p.product_name])),
    vendor: new Map((vendors ?? []).map((v) => [v.id, v.vendor_name])),
  };
}

async function demandsByIds(supabase: Client, ids: string[]) {
  if (ids.length === 0) return new Map<string, ItDemand>();
  const { data } = await supabase.schema("it").from("demands").select("*").in("id", ids);
  return new Map((data ?? []).map((d) => [d.id, d as ItDemand]));
}

export async function buildProcurementReport(
  supabase: Client,
  kind: ProcurementReportKind,
  from: Date,
  to: Date,
): Promise<{ columns: string[]; rows: string[][] }> {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const names = await lookups(supabase);
  const name = (map: Map<string, string>, id: string | null | undefined) => (id && map.get(id)) || "—";

  if (kind === "register") {
    const { data, error } = await supabase
      .schema("it")
      .from("demands")
      .select("*")
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .order("created_at");
    if (error) throw new Error(error.message);
    const demands = (data ?? []) as ItDemand[];
    const ids = demands.map((d) => d.id);
    const [{ data: invoices }, { data: payments }] = ids.length
      ? await Promise.all([
          supabase.schema("it").from("invoices").select("demand_id, invoice_amount").in("demand_id", ids),
          supabase.schema("it").from("payments").select("demand_id, paid_amount").in("demand_id", ids),
        ])
      : [{ data: [] }, { data: [] }];
    const sumBy = (rows: { demand_id: string }[], field: "invoice_amount" | "paid_amount") => {
      const m = new Map<string, number>();
      for (const r of rows as Record<string, unknown>[]) {
        const id = r.demand_id as string;
        m.set(id, (m.get(id) ?? 0) + Number(r[field] ?? 0));
      }
      return m;
    };
    const invoiced = sumBy(invoices ?? [], "invoice_amount");
    const paid = sumBy(payments ?? [], "paid_amount");

    return {
      columns: [
        "Demand", "Raised", "Site", "Department", "Product", "Category", "Requested", "Approved",
        "Accepted", "Status", "Vendor", "Estimated total", "Agreed total", "Invoiced", "Paid", "Days open",
      ],
      rows: demands.map((d) => {
        const target = d.approved_quantity ?? d.quantity;
        const end = d.closed_at ?? d.cancelled_at ?? new Date().toISOString();
        return [
          d.demand_number,
          fmtDate(d.created_at),
          name(names.unit, d.site_id),
          name(names.unit, d.department_id),
          name(names.product, d.product_id),
          d.demand_category ?? "",
          String(d.quantity),
          d.approved_quantity === null ? "" : String(d.approved_quantity),
          String(d.received_quantity),
          d.status,
          d.vendor_id ? name(names.vendor, d.vendor_id) : "",
          d.estimated_unit_price === null ? "" : formatMoney(Number(d.estimated_unit_price) * d.quantity),
          d.agreed_unit_price === null ? "" : formatMoney(Number(d.agreed_unit_price) * target),
          invoiced.has(d.id) ? formatMoney(invoiced.get(d.id)) : "",
          paid.has(d.id) ? formatMoney(paid.get(d.id)) : "",
          fmtDays(days(d.created_at, end)),
        ];
      }),
    };
  }

  if (kind === "cycle") {
    const { data, error } = await supabase
      .schema("it")
      .from("demands")
      .select("*")
      .eq("status", "Closed")
      .gte("closed_at", fromIso)
      .lt("closed_at", toIso)
      .order("closed_at");
    if (error) throw new Error(error.message);
    const demands = (data ?? []) as ItDemand[];
    const ids = demands.map((d) => d.id);
    const [{ data: approvals }, { data: receivings }, { data: invoices }] = ids.length
      ? await Promise.all([
          supabase.schema("it").from("demand_approvals").select("demand_id, decided_at").in("demand_id", ids),
          supabase.schema("it").from("receiving_records").select("demand_id, received_date").in("demand_id", ids),
          supabase.schema("it").from("invoices").select("demand_id, paid_at").in("demand_id", ids),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];
    const latest = (rows: Record<string, unknown>[], field: string) => {
      const m = new Map<string, string>();
      for (const r of rows) {
        const id = r.demand_id as string;
        const v = r[field] as string | null;
        if (v && (!m.has(id) || v > m.get(id)!)) m.set(id, v);
      }
      return m;
    };
    const approvedAt = latest(approvals ?? [], "decided_at");
    const receivedAt = latest(receivings ?? [], "received_date");
    const paidAt = latest(invoices ?? [], "paid_at");

    const rows = demands.map((d) => {
      const a = approvedAt.get(d.id) ?? null;
      const consumable = d.demand_category === "Consumable" && !a;
      return {
        d,
        approve: days(d.created_at, a),
        order: days(a, d.vendor_assigned_at),
        receive: days(d.vendor_assigned_at, receivedAt.get(d.id) ?? null),
        pay: days(receivedAt.get(d.id) ?? null, paidAt.get(d.id) ?? null),
        total: days(d.created_at, d.closed_at),
        consumable,
      };
    });
    const avgRow = [
      "Average",
      "",
      "",
      fmtDays(avg(rows.map((r) => r.approve))),
      fmtDays(avg(rows.map((r) => r.order))),
      fmtDays(avg(rows.map((r) => r.receive))),
      fmtDays(avg(rows.map((r) => r.pay))),
      fmtDays(avg(rows.map((r) => r.total))),
    ];
    return {
      columns: ["Demand", "Product", "Path", "Raised → approved", "Approved → ordered", "Ordered → received", "Received → paid", "Total days"],
      rows: [
        ...rows.map((r) => [
          r.d.demand_number,
          name(names.product, r.d.product_id),
          r.consumable ? "From stock" : "Purchase",
          fmtDays(r.approve),
          fmtDays(r.order),
          fmtDays(r.receive),
          fmtDays(r.pay),
          fmtDays(r.total),
        ]),
        ...(rows.length ? [avgRow] : []),
      ],
    };
  }

  if (kind === "spend-vendor" || kind === "spend-department" || kind === "spend-site") {
    const { data, error } = await supabase
      .schema("it")
      .from("payments")
      .select("*")
      .gte("payment_date", fromIso.slice(0, 10))
      .lt("payment_date", toIso.slice(0, 10));
    if (error) throw new Error(error.message);
    const payments = (data ?? []) as ItPayment[];
    const demands = await demandsByIds(supabase, [...new Set(payments.map((p) => p.demand_id))]);
    const groups = new Map<string, { amount: number; payments: number; invoices: Set<string>; demands: Set<string> }>();
    for (const p of payments) {
      const key =
        kind === "spend-vendor"
          ? name(names.vendor, p.vendor_id)
          : kind === "spend-site"
            ? name(names.unit, p.site_id)
            : name(names.unit, demands.get(p.demand_id)?.department_id);
      const g = groups.get(key) ?? { amount: 0, payments: 0, invoices: new Set(), demands: new Set() };
      g.amount += Number(p.paid_amount);
      g.payments += 1;
      g.invoices.add(p.invoice_id);
      g.demands.add(p.demand_id);
      groups.set(key, g);
    }
    const total = [...groups.values()].reduce((s, g) => s + g.amount, 0);
    const label = kind === "spend-vendor" ? "Vendor" : kind === "spend-site" ? "Site" : "Department";
    return {
      columns: [label, "Amount paid", "Share", "Payments", "Invoices", "Demands"],
      rows: [...groups.entries()]
        .sort((a, b) => b[1].amount - a[1].amount)
        .map(([key, g]) => [
          key,
          formatMoney(g.amount),
          total > 0 ? `${Math.round((g.amount / total) * 100)}%` : "",
          String(g.payments),
          String(g.invoices.size),
          String(g.demands.size),
        ]),
    };
  }

  if (kind === "shortfalls") {
    const { data, error } = await supabase
      .schema("it")
      .from("demands")
      .select("*")
      .in("status", ["Assigned to Vendor", "Partially Received"])
      .order("expected_delivery_date", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    const demands = (data ?? []) as ItDemand[];
    const ids = demands.map((d) => d.id);
    const { data: recs } = ids.length
      ? await supabase
          .schema("it")
          .from("receiving_records")
          .select("demand_id, received_quantity, accepted_quantity")
          .in("demand_id", ids)
      : { data: [] };
    const damaged = new Map<string, number>();
    for (const r of (recs ?? []) as Pick<ItReceivingRecord, "demand_id" | "received_quantity" | "accepted_quantity">[]) {
      damaged.set(r.demand_id, (damaged.get(r.demand_id) ?? 0) + (r.received_quantity - r.accepted_quantity));
    }
    const today = new Date().toISOString().slice(0, 10);
    return {
      columns: ["Demand", "Product", "Vendor", "Site", "Approved", "Accepted", "Still due", "Not accepted", "Expected", "Days late"],
      rows: demands.map((d) => {
        const target = d.approved_quantity ?? d.quantity;
        const late =
          d.expected_delivery_date && d.expected_delivery_date < today
            ? Math.floor(days(d.expected_delivery_date, today) ?? 0)
            : 0;
        return [
          d.demand_number,
          name(names.product, d.product_id),
          name(names.vendor, d.vendor_id),
          name(names.unit, d.site_id),
          String(target),
          String(d.received_quantity),
          String(Math.max(0, target - d.received_quantity)),
          String(damaged.get(d.id) ?? 0),
          fmtDate(d.expected_delivery_date),
          late > 0 ? String(late) : "",
        ];
      }),
    };
  }

  // finance
  const { data, error } = await supabase
    .schema("it")
    .from("invoices")
    .select("*")
    .in("status", ["Sent to Finance", "Confirmed"])
    .order("finance_due_on", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  const invoices = (data ?? []) as ItInvoice[];
  const demands = await demandsByIds(supabase, [...new Set(invoices.map((i) => i.demand_id))]);
  const today = new Date().toISOString().slice(0, 10);
  return {
    columns: ["Invoice", "Vendor", "Demand", "Site", "Amount", "Paid", "Unpaid", "Sent to Finance", "Due", "Days overdue", "Status"],
    rows: invoices.map((i) => {
      const overdue =
        i.finance_due_on && i.finance_due_on < today ? Math.floor(days(i.finance_due_on, today) ?? 0) : 0;
      return [
        i.invoice_number,
        name(names.vendor, i.vendor_id),
        demands.get(i.demand_id)?.demand_number ?? "—",
        name(names.unit, i.site_id),
        formatMoney(i.invoice_amount),
        formatMoney(i.paid_amount),
        formatMoney(Number(i.invoice_amount) - Number(i.paid_amount)),
        fmtDate(i.sent_to_finance_at),
        fmtDate(i.finance_due_on),
        overdue > 0 ? String(overdue) : "",
        i.status,
      ];
    }),
  };
}

// Dashboard figures (as of now, plus spend in the period). Same RLS scoping.
export async function procurementKpis(supabase: Client, from: Date, to: Date) {
  const today = new Date().toISOString().slice(0, 10);
  const count = (statuses: ItDemand["status"][]) =>
    supabase.schema("it").from("demands").select("id", { count: "exact", head: true }).in("status", statuses);

  const [openRes, approvalRes, deliveryRes, lateRes, financeRes, paymentsRes, raisedRes] = await Promise.all([
    count(["Open", "Categorized"]),
    count(["Pending Approval"]),
    count(["Approved", "Partially Approved", "Assigned to Vendor", "Partially Received"]),
    supabase
      .schema("it")
      .from("demands")
      .select("id", { count: "exact", head: true })
      .in("status", ["Assigned to Vendor", "Partially Received"])
      .lt("expected_delivery_date", today),
    supabase
      .schema("it")
      .from("invoices")
      .select("invoice_amount, paid_amount, finance_due_on")
      .in("status", ["Sent to Finance", "Confirmed"]),
    supabase
      .schema("it")
      .from("payments")
      .select("paid_amount, vendor_id")
      .gte("payment_date", from.toISOString().slice(0, 10))
      .lt("payment_date", to.toISOString().slice(0, 10)),
    supabase
      .schema("it")
      .from("demands")
      .select("id", { count: "exact", head: true })
      .gte("created_at", from.toISOString())
      .lt("created_at", to.toISOString()),
  ]);

  const atFinance = financeRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const byVendor = new Map<string, number>();
  for (const p of payments) {
    const key = p.vendor_id ?? "—";
    byVendor.set(key, (byVendor.get(key) ?? 0) + Number(p.paid_amount));
  }

  return {
    toRoute: openRes.count ?? 0,
    awaitingApproval: approvalRes.count ?? 0,
    awaitingDelivery: deliveryRes.count ?? 0,
    lateDeliveries: lateRes.count ?? 0,
    atFinance: atFinance.length,
    overdueAtFinance: atFinance.filter((i) => i.finance_due_on !== null && i.finance_due_on < today).length,
    unpaidAtFinance: atFinance.reduce((s, i) => s + Number(i.invoice_amount) - Number(i.paid_amount), 0),
    spent: payments.reduce((s, p) => s + Number(p.paid_amount), 0),
    raised: raisedRes.count ?? 0,
    spendByVendorId: [...byVendor.entries()].sort((a, b) => b[1] - a[1]),
  };
}
