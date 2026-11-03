"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { formatMoney } from "@/lib/it/procurement";

export type DemandProduct = {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  price: number | null;
  fixedAsset: boolean;
};
type Option = { id: string; name: string };
type Category = { value: string; label: string; hint: string };

const fieldClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20";

// Raise Demand (PRC-04, BRD §5.5.1–§5.5.2): four numbered steps on the left, a live summary on
// the right saying what it costs and where it goes next. Submits the same fields as before
// (productId, category, quantity, departmentId, siteId, justification) to createDemand.
export function DemandForm({
  action,
  products,
  categories,
  departments,
  sites,
  defaultSite,
  defaultProduct,
  approvers,
  consumablePath,
  canManageApprovers,
  canAddProducts,
}: {
  action: (formData: FormData) => void | Promise<void>;
  products: DemandProduct[];
  categories: Category[];
  departments: Option[];
  sites: Option[];
  defaultSite: string;
  defaultProduct?: string;
  approvers: Record<string, string[]>;
  consumablePath: boolean;
  canManageApprovers: boolean;
  canAddProducts: boolean;
}) {
  const initial = products.find((p) => p.id === defaultProduct);
  const [query, setQuery] = useState("");
  const [productId, setProductId] = useState(initial?.id ?? "");
  const [category, setCategory] = useState(initial ? suggested(initial) : "");
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [departmentId, setDepartmentId] = useState("");
  const [siteId, setSiteId] = useState(defaultSite);
  const [justification, setJustification] = useState("");

  const product = products.find((p) => p.id === productId);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => `${p.name} ${p.category ?? ""}`.toLowerCase().includes(q));
  }, [products, query]);

  const total = product?.price != null ? product.price * quantity : null;
  const departmentName = departments.find((d) => d.id === departmentId)?.name;
  const siteName = sites.find((s) => s.id === siteId)?.name;
  const approverNames = approvers[departmentId] ?? [];
  const fromStock = category === "Consumable" && consumablePath;
  const ready = Boolean(productId && category && departmentId && siteId && justification.trim() && quantity >= 1);

  function pickProduct(p: DemandProduct) {
    setProductId(p.id);
    // Fixed assets can never be consumables (same rule as the server).
    if (!categoryTouched || (p.fixedAsset && category === "Consumable")) {
      setCategory(suggested(p));
    }
  }

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-3">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="category" value={category} />

      <div className="space-y-6 lg:col-span-2">
        {/* 1 — Product */}
        <Section step={1} title="What do you need?" done={Boolean(product)}>
          <div className="relative mb-3">
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              fill="currentColor"
              className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
            >
              <path
                fillRule="evenodd"
                d="M9 3.5a5.5 5.5 0 1 0 3.4 9.83l3.13 3.14a.75.75 0 1 0 1.06-1.06l-3.13-3.14A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z"
                clipRule="evenodd"
              />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${products.length} product${products.length === 1 ? "" : "s"} by name or category…`}
              aria-label="Search products"
              className={`${fieldClass} pl-9`}
            />
          </div>

          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
              No product matches &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <div role="radiogroup" aria-label="Product" className="grid max-h-80 gap-3 overflow-y-auto p-0.5 sm:grid-cols-2">
              {visible.map((p) => {
                const selected = p.id === productId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => pickProduct(p)}
                    className={`relative flex items-start gap-3 rounded-xl border p-3 text-left transition ${
                      selected
                        ? "border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/20"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition ${
                        selected ? "bg-blue-600 text-white shadow-sm" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      <ProductIcon kind={productKind(p)} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">{p.name}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {[p.category, `per ${p.unit}`].filter(Boolean).join(" · ")}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium tabular-nums text-slate-800">{formatMoney(p.price)}</span>
                        {p.fixedAsset && (
                          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                            Fixed asset
                          </span>
                        )}
                      </span>
                    </span>
                    {selected && <CheckDot />}
                  </button>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Not in the list?{" "}
            {canAddProducts ? (
              <Link href="/it/procurement/products" className="font-medium text-blue-700 hover:underline">
                Add it to the Product Master
              </Link>
            ) : (
              "Ask procurement to add it to the Product Master."
            )}
          </p>
        </Section>

        {/* 2 — Category */}
        <Section step={2} title="What kind of request is it?" done={Boolean(category)}>
          <div role="radiogroup" aria-label="Category" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {categories.map((c) => {
              const selected = c.value === category;
              const blocked = c.value === "Consumable" && Boolean(product?.fixedAsset);
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={blocked}
                  title={blocked ? "A fixed-asset product can't be a consumable" : undefined}
                  onClick={() => {
                    setCategory(c.value);
                    setCategoryTouched(true);
                  }}
                  className={`relative rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    selected
                      ? "border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/20"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <span className="block pr-6 text-sm font-semibold text-slate-900">{c.label}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-slate-500">{c.hint}</span>
                  {selected && <CheckDot />}
                </button>
              );
            })}
          </div>
          {product?.fixedAsset && (
            <p className="mt-3 text-xs text-slate-500">
              {product.name} is a fixed asset, so it is bought through approval — not issued as a consumable.
            </p>
          )}
        </Section>

        {/* 3 — Quantity, department, site */}
        <Section step={3} title="How many, and for whom?" done={Boolean(departmentId && siteId)}>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="quantity" className="mb-1 block text-sm font-medium text-slate-700">
                Quantity <span className="text-red-500">*</span>
              </label>
              <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="px-3 text-lg text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                  disabled={quantity <= 1}
                >
                  −
                </button>
                <input
                  id="quantity"
                  type="number"
                  name="quantity"
                  min={1}
                  max={100000}
                  step={1}
                  required
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Math.min(100000, Math.floor(Number(e.target.value) || 1))))}
                  className="w-full border-0 text-center text-sm tabular-nums focus:outline-none focus:ring-0"
                />
                <button
                  type="button"
                  aria-label="Increase quantity"
                  onClick={() => setQuantity((q) => Math.min(100000, q + 1))}
                  className="px-3 text-lg text-slate-500 hover:bg-slate-50"
                >
                  +
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Quick quantity">
                {QUICK_QUANTITIES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setQuantity(n)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition ${
                      quantity === n
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {n}
                  </button>
                ))}
                {product && <span className="self-center text-xs text-slate-400">{product.unit}</span>}
              </div>
            </div>
            <div>
              <label htmlFor="departmentId" className="mb-1 block text-sm font-medium text-slate-700">
                Department <span className="text-red-500">*</span>
              </label>
              <select
                id="departmentId"
                name="departmentId"
                required
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className={fieldClass}
              >
                <option value="" disabled>
                  Choose…
                </option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="siteId" className="mb-1 block text-sm font-medium text-slate-700">
                Site <span className="text-red-500">*</span>
              </label>
              <select
                id="siteId"
                name="siteId"
                required
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                className={fieldClass}
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Section>

        {/* 4 — Justification */}
        <Section step={4} title="Why is it needed?" done={Boolean(justification.trim())}>
          <p className="mb-2 text-xs text-slate-500">Start from a template, then fill in the details:</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {REASONS.map((r) => (
              <button
                key={r.label}
                type="button"
                onClick={() => setJustification(r.text)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
              >
                {r.label}
              </button>
            ))}
          </div>
          <textarea
            name="justification"
            rows={4}
            required
            maxLength={2000}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Who is it for, what is it replacing or fixing, and by when is it needed?"
            className={fieldClass}
          />
          <p className="mt-1 text-right text-xs text-slate-400">{justification.length} / 2000</p>
        </Section>
      </div>

      {/* Live summary */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-br from-blue-600 to-indigo-600 px-5 py-4 text-white">
            <p className="text-xs font-medium uppercase tracking-wide text-blue-100">Estimated total</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{formatMoney(total ?? (product ? null : 0))}</p>
            <p className="mt-1 text-xs text-blue-100">
              {product ? `${quantity} × ${formatMoney(product.price)} per ${product.unit}` : "Pick a product to see the cost"}
            </p>
          </div>

          <dl className="divide-y divide-slate-100 px-5 text-sm">
            <SummaryRow label="Product" value={product?.name} />
            <SummaryRow label="Category" value={categories.find((c) => c.value === category)?.label} />
            <SummaryRow label="Department" value={departmentName} />
            <SummaryRow label="Site" value={siteName} />
          </dl>

          <div className="border-t border-slate-100 px-5 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Where it goes</p>
            {fromStock ? (
              <Route tone="emerald" title="Issued from stock">
                Consumables skip approval — procurement issues them from stock.
              </Route>
            ) : !departmentId ? (
              <Route tone="slate" title="Choose a department">
                The department&apos;s approver decides on the demand.
              </Route>
            ) : approverNames.length > 0 ? (
              <Route tone="emerald" title={`Approval by ${approverNames.join(", ")}`}>
                Sent automatically as soon as you submit.
              </Route>
            ) : (
              <Route tone="amber" title={`${departmentName} has no approver yet`}>
                The demand waits and is sent automatically once one is added.
                {canManageApprovers && (
                  <>
                    {" "}
                    <Link href="/it/procurement/settings/approvers" className="font-medium underline">
                      Add approver
                    </Link>
                  </>
                )}
              </Route>
            )}

            <ol className="mt-4 space-y-2 text-xs text-slate-500">
              {(fromStock
                ? ["Procurement issues it from stock", "You're notified when it's done"]
                : ["Department head approves", "Procurement orders from a vendor", "Delivery received, invoice paid"]
              ).map((s, i) => (
                <li key={s} className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
          </div>

          <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
            <SubmitButton ready={ready} />
            <p className="mt-2 text-center text-xs text-slate-400">
              {ready ? "The price is fixed from the Product Master on submit." : "Complete steps 1–4 to submit."}
            </p>
          </div>
        </div>
      </aside>
    </form>
  );
}

const QUICK_QUANTITIES = [1, 2, 5, 10];

// Starting points for the justification (BRD: who, why, by when) — the user edits the blanks.
const REASONS = [
  { label: "New joiner", text: "For a new joiner: [name], [designation], joining on [date]." },
  { label: "Replacement", text: "Replacement for a faulty / broken item: [asset tag or description]. Problem: [what is wrong]." },
  { label: "Upgrade", text: "Upgrade needed because [current item] no longer meets [requirement]. Needed by [date]." },
  { label: "Project / event", text: "Needed for [project or event] starting [date], used by [team]." },
  { label: "Spare stock", text: "Spare stock for quick replacements at [site]; current spares: [number]." },
];

type Kind = "laptop" | "desktop" | "monitor" | "printer" | "network" | "phone" | "accessory" | "box";

// A picture for the product card, guessed from its name / category.
function productKind(p: DemandProduct): Kind {
  const t = `${p.name} ${p.category ?? ""}`.toLowerCase();
  if (/laptop|notebook|macbook|thinkpad/.test(t)) return "laptop";
  if (/desktop|\bpc\b|workstation|\bcpu\b/.test(t)) return "desktop";
  if (/monitor|screen|display|\blcd\b|\bled\b/.test(t)) return "monitor";
  if (/printer|scanner|toner|cartridge|\bink\b/.test(t)) return "printer";
  if (/router|switch|network|cable|wifi|access point|firewall/.test(t)) return "network";
  if (/phone|mobile|tablet|ipad/.test(t)) return "phone";
  if (/mouse|keyboard|headset|webcam|charger|adapter|\busb\b|\bhdd\b|\bssd\b|\bram\b/.test(t)) return "accessory";
  return "box";
}

function ProductIcon({ kind }: { kind: Kind }) {
  const paths: Record<Kind, string> = {
    laptop: "M5 6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5V15H5V6.5ZM3 17h18l-1 2H4l-1-2Z",
    desktop: "M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 14.5v-9ZM9 20h6M12 16v4",
    monitor: "M3 5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5v-10ZM8 20h8",
    printer: "M7 9V4h10v5M6 18H4.5A1.5 1.5 0 0 1 3 16.5v-6A1.5 1.5 0 0 1 4.5 9h15a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H18M7 14h10v6H7v-6Z",
    network: "M12 4v5M5 20v-4h14v4M12 9a2 2 0 1 0 0 .01M5 20a1 1 0 1 0 0 .01M19 20a1 1 0 1 0 0 .01M12 11v5",
    phone: "M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3ZM11 18h2",
    accessory: "M12 3a5 5 0 0 1 5 5v8a5 5 0 0 1-10 0V8a5 5 0 0 1 5-5ZM12 3v6",
    box: "M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9ZM4 7.5l8 4.5 8-4.5M12 12v9",
  };
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6"
    >
      <path d={paths[kind]} />
    </svg>
  );
}

function suggested(p: DemandProduct) {
  // Fixed-asset products are a purchase; anything else is suggested as a consumable.
  return p.fixedAsset ? "Open" : "Consumable";
}

function Section({
  step,
  title,
  done,
  children,
}: {
  step: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="mb-4 flex items-center gap-3 text-base font-semibold text-slate-900">
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold transition ${
            done ? "bg-emerald-500 text-white" : "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
          }`}
        >
          {done ? "✓" : step}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function CheckDot() {
  return (
    <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[11px] text-white">
      ✓
    </span>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`truncate text-right font-medium ${value ? "text-slate-900" : "text-slate-300"}`}>{value ?? "—"}</dd>
    </div>
  );
}

function Route({
  tone,
  title,
  children,
}: {
  tone: "emerald" | "amber" | "slate";
  title: string;
  children: React.ReactNode;
}) {
  const styles = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    slate: "border-slate-200 bg-slate-50 text-slate-600",
  }[tone];
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${styles}`}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-0.5 text-xs opacity-90">{children}</p>
    </div>
  );
}

function SubmitButton({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={!ready || pending}
      className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
    >
      {pending ? "Raising demand…" : "Raise demand"}
    </button>
  );
}
