import "server-only";

// Sends mail via Microsoft Graph's /users/{id}/sendMail as an app-only (client-credentials)
// caller — reuses the same Azure AD app-registration pattern already used for SSO instead of
// bringing in a third-party email vendor or relying on SMTP AUTH (which many tenants now block
// via Conditional Access). Needs its own Azure AD app registration with the Application
// permission `Mail.Send` (admin-consented), ideally scoped to one sender mailbox via an Exchange
// Online application access policy — see 05-setup-runbook.md for the exact steps.
//
// Required env vars:
//   MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET — the app registration
//   MS_GRAPH_SENDER_EMAIL — mailbox to send from (e.g. a shared mailbox like
//     no-reply@faujifoods.com); the app-only token must be allowed to send as this address
//   MS_GRAPH_SENDER_NAME — optional display name, defaults below

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const tenantId = process.env.MS_GRAPH_TENANT_ID!;
  const clientId = process.env.MS_GRAPH_CLIENT_ID!;
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET!;

  const response = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to acquire Graph API token (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.value;
}

export async function sendMail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const senderEmail = process.env.MS_GRAPH_SENDER_EMAIL!;
  const senderName = process.env.MS_GRAPH_SENDER_NAME ?? "Fauji Foods Employee Portal";

  const token = await getAccessToken();

  const response = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(senderEmail)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          from: { emailAddress: { address: senderEmail, name: senderName } },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: false,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Graph sendMail failed (${response.status}): ${body}`);
  }
}
