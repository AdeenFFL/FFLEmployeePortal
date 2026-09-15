import "server-only";
import { sendMail } from "./graph-client";
import type { AuthMethod } from "@/types/database";

function inviteEmailHtml({
  displayName,
  loginUrl,
  authMethod,
}: {
  displayName: string | null;
  loginUrl: string;
  authMethod: AuthMethod;
}) {
  const greeting = displayName ? `Hi ${displayName},` : "Hi,";
  const howToSignIn =
    authMethod === "password"
      ? "Your administrator will share your login email and a temporary password with you separately. Once you have them, sign in below."
      : "Sign in below using your Microsoft 365 work account — no separate password is needed.";

  return `
    <div style="font-family: -apple-system, Segoe UI, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #0f172a;">
      <p>${greeting}</p>
      <p>You've been added to the <strong>Fauji Foods Employee Portal</strong>.</p>
      <p>${howToSignIn}</p>
      <p style="margin: 24px 0;">
        <a href="${loginUrl}"
           style="background-color: #2563eb; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">
          Open the Employee Portal
        </a>
      </p>
      <p style="color: #64748b; font-size: 13px;">
        If the button doesn't work, copy this link into your browser: ${loginUrl}
      </p>
      <p style="color: #94a3b8; font-size: 12px; margin-top: 32px;">
        If you weren't expecting this, contact IT — no action is needed on your part otherwise.
      </p>
    </div>
  `;
}

// Best-effort: an email delivery hiccup should never block provisioning an employee's account.
// Logs and swallows its own errors, same pattern as lib/audit/log.ts's logAuditEvent().
export async function sendInviteEmail({
  to,
  displayName,
  authMethod,
}: {
  to: string;
  displayName: string | null;
  authMethod: AuthMethod;
}): Promise<{ sent: boolean; error?: string }> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const loginUrl = `${siteUrl}/login`;

  try {
    await sendMail({
      to,
      subject: "You've been added to the Fauji Foods Employee Portal",
      html: inviteEmailHtml({ displayName, loginUrl, authMethod }),
    });
    return { sent: true };
  } catch (error) {
    console.error("sendInviteEmail failed", error);
    return { sent: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
