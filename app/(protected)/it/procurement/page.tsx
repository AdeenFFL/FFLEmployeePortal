import { redirect } from "next/navigation";

// The sidebar's single "Procurement" entry lands on Demands — the hub everyone starts from.
export default function ProcurementPage() {
  redirect("/it/procurement/demands");
}
