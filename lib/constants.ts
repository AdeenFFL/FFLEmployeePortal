// Placeholder — confirm the real address with IT/HR before shipping. No ticketing system exists;
// used by /unauthorized's "Contact Administrator" button and the sidebar's "Support" item.
export const SUPPORT_EMAIL = "hr.helpdesk@faujifoods.com";

// Single source of truth for the product name/tagline — used in page metadata, the login
// screen, and the sidebar header, so renaming the product again means changing it in one place.
export const APP_NAME = "Employee Campsite";
export const APP_TAGLINE = "Fauji Food Vertical Employee Portal";

// Used to suggest a company email/username on the onboarding "Email Account" checklist task
// (lib/it/onboarding.ts's suggestEmailAccount) — a suggestion only, IT confirms/edits it before
// actually creating the mailbox in Microsoft 365. Single company domain for now; if a second
// ever applies, this becomes a per-company lookup instead of one constant.
export const COMPANY_EMAIL_DOMAIN = "faujifoods.com";
