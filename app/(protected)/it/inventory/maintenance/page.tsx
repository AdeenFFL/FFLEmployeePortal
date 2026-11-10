import { redirect } from "next/navigation";

// Repairs are demands in Procurement now; each asset shows its own repair and history.
export default function MaintenanceRedirect() {
  redirect("/it/inventory?status=In+Repair");
}
