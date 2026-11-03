import { getCurrentUserNav } from "../../current-user";
import { ProcurementNav, type ProcurementTab } from "./_components/procurement-nav";

// Procurement sits under IT Management as one sidebar entry; its sections are this tab bar.
// Tabs use the same permissions as the pages (lib/auth/route-permissions.ts + the page checks).
const TABS: (ProcurementTab & { permission: string[] })[] = [
  {
    href: "/it/procurement/demands",
    label: "Demands",
    match: ["/it/procurement/demands", "/it/procurement/invoices"],
    permission: ["it.demands.create", "it.demands.read", "it.demands.read_all"],
  },
  {
    href: "/it/procurement/approvals",
    label: "Approvals",
    permission: ["it.demands.approve", "it.invoices.approve"],
  },
  { href: "/it/procurement/finance", label: "Finance", permission: ["it.payments.update"] },
  {
    href: "/it/procurement/reports",
    label: "Reports",
    permission: ["it.demands.read", "it.demands.read_all", "it.payments.update"],
  },
  {
    href: "/it/procurement/vendors",
    label: "Vendors",
    permission: ["it.vendors.update", "it.demands.read", "it.demands.read_all", "it.demands.approve"],
  },
  {
    href: "/it/procurement/products",
    label: "Products",
    permission: ["it.products.update", "it.demands.read", "it.demands.read_all", "it.demands.approve"],
  },
  { href: "/it/procurement/settings", label: "Settings", permission: ["it.procurement_settings.update"] },
];

export default async function ProcurementLayout({ children }: { children: React.ReactNode }) {
  const { permissions } = await getCurrentUserNav();
  const granted = new Set(permissions);
  const tabs: ProcurementTab[] = TABS.filter((t) => t.permission.some((p) => granted.has(p))).map((t) => ({
    href: t.href,
    label: t.label,
    match: t.match,
  }));

  return (
    <div>
      <ProcurementNav tabs={tabs} canRaise={granted.has("it.demands.create")} />
      {children}
    </div>
  );
}
