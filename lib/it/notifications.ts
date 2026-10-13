import "server-only";
import { after } from "next/server";
import { sendMail } from "@/lib/email/graph-client";
import { createAdminClient } from "@/lib/supabase/admin";

// Emails for it.notifications rows (javaria_it_0003_notifications.sql). The database decides
// WHO gets notified (triggers); this only delivers. Uses the secret-key client because the
// actor who triggered a notification can't read other people's inbox rows or email addresses
// under RLS — a third narrow use alongside the two listed in lib/supabase/admin.ts.

const BATCH = 25;

export function emailConfigured() {
  return Boolean(
    process.env.MS_GRAPH_TENANT_ID &&
      process.env.MS_GRAPH_CLIENT_ID &&
      process.env.MS_GRAPH_CLIENT_SECRET &&
      process.env.MS_GRAPH_SENDER_EMAIL,
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emailHtml({ title, body, url }: { title: string; body: string | null; url: string }) {
  return `
    <div style="font-family: -apple-system, Segoe UI, Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #0f172a;">
      <p style="font-size: 16px; font-weight: 600;">${escapeHtml(title)}</p>
      ${body ? `<p style="white-space: pre-wrap; color: #334155;">${escapeHtml(body)}</p>` : ""}
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(url)}"
           style="background-color: #2563eb; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">
          Open in the Employee Portal
        </a>
      </p>
      <p style="color: #94a3b8; font-size: 12px; margin-top: 32px;">
        IT Service Management · Fauji Foods Employee Portal. You're receiving this because of
        activity on a request you're involved in.
      </p>
    </div>
  `;
}

// Sends up to BATCH pending emails. Never throws: a mail problem must not affect the action that
// queued it (same rule as lib/email/invite.ts).
export async function dispatchItEmails() {
  try {
    const admin = createAdminClient();
    const { data: pending } = await admin
      .schema("it")
      .from("notifications")
      .select("id, recipient_person_id, recipient_email, title, body, link")
      .eq("email_status", "pending")
      .order("created_at")
      .limit(BATCH);
    if (!pending || pending.length === 0) return;

    if (!emailConfigured()) {
      await admin
        .schema("it")
        .from("notifications")
        .update({ email_status: "skipped", email_error: "Email not configured (MS_GRAPH_*)" })
        .in(
          "id",
          pending.map((n) => n.id),
        );
      return;
    }

    // Claim the batch first so two overlapping dispatches can't both send it.
    const { data: claimed } = await admin
      .schema("it")
      .from("notifications")
      .update({ email_status: "sent", emailed_at: new Date().toISOString() })
      .in(
        "id",
        pending.map((n) => n.id),
      )
      .eq("email_status", "pending")
      .select("id");
    const claimedIds = new Set((claimed ?? []).map((c) => c.id));
    const batch = pending.filter((n) => claimedIds.has(n.id));

    const personIds = [
      ...new Set(batch.map((n) => n.recipient_person_id).filter((id): id is string => Boolean(id))),
    ];
    const { data: accounts } = personIds.length
      ? await admin.from("user_accounts").select("person_id, email").in("person_id", personIds)
      : { data: [] };
    const emailByPerson = new Map((accounts ?? []).map((a) => [a.person_id, a.email]));
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");

    for (const n of batch) {
      const to = n.recipient_email ?? (n.recipient_person_id && emailByPerson.get(n.recipient_person_id));
      if (!to) {
        await admin
          .schema("it")
          .from("notifications")
          .update({ email_status: "skipped", email_error: "Recipient has no email address" })
          .eq("id", n.id);
        continue;
      }
      try {
        await sendMail({
          to,
          subject: n.title,
          html: emailHtml({ title: n.title, body: n.body, url: `${siteUrl}${n.link ?? "/it/notifications"}` }),
        });
      } catch (error) {
        await admin
          .schema("it")
          .from("notifications")
          .update({
            email_status: "failed",
            email_error: (error instanceof Error ? error.message : "Unknown error").slice(0, 500),
          })
          .eq("id", n.id);
      }
    }
  } catch (error) {
    console.error("dispatchItEmails failed", error);
  }
}

// Call at the end of any IT mutation: runs after the response is sent (including after a
// redirect), so the user never waits on email delivery.
export function queueItEmails() {
  after(dispatchItEmails);
}
