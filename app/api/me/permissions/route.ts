import { NextResponse } from "next/server";
import { getCurrentUserNav } from "@/app/(protected)/current-user";
import { getNavExtras } from "@/app/(protected)/hr/clearance/clearance-nav";

// The signed-in person's current permission keys, for the sidebar to re-check after a role or
// permission change (app/(protected)/sidebar.tsx). A plain GET, not a server action, so it never
// queues behind (or delays) a form being saved. Also carries the menu-only flags (Clearance for
// signers, My Tasks for open work) and the number on My Tasks, so they stay right after a re-check.
export const dynamic = "force-dynamic";

export async function GET() {
  const [{ permissions, homePath }, navExtras] = await Promise.all([getCurrentUserNav(), getNavExtras()]);
  return NextResponse.json(
    { permissions: [...permissions, ...navExtras.keys], homePath, taskCount: navExtras.taskCount,
      clearanceCount: navExtras.clearanceCount,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
