import { NextResponse } from "next/server";
import { getCurrentUserNav } from "@/app/(protected)/current-user";

// The signed-in person's current permission keys, for the sidebar to re-check after a role or
// permission change (app/(protected)/sidebar.tsx). A plain GET, not a server action, so it never
// queues behind (or delays) a form being saved.
export const dynamic = "force-dynamic";

export async function GET() {
  const { permissions, homePath } = await getCurrentUserNav();
  return NextResponse.json({ permissions, homePath }, { headers: { "Cache-Control": "no-store" } });
}
