# HR Clearance (Offboarding): test checklist

Run this after every merge from `develop` into `it/talha` (or `it/dev`), and before handing a
clearance change to HR. Each test says what to do and what you should see. Mark it ✅ or ❌ and note
the case number you used.

**Accounts you need** (one browser profile or private window each):

| Who | Role / setup |
|---|---|
| Employee | Any active employee with a site and department (not a signer for their own case) |
| HRBP | Holds `hr.clearance.read_all` + `hr.clearance.forward`, and is the HR signer for that site |
| Dept Head | Department Head signer for the employee's department |
| Admin / Store | Admin and Store signers for the site |
| Accounts | Accounts signer for the site |
| IT Lead | IT signer for the site (IT Team Lead) |
| IT staff | Another IT staff member (for Assign) |

Signers are set in **Clearance > Clearance Signers**.

---

## A. Starting a request

| # | Steps | Expected |
|---|---|---|
| A1 | Employee: Profile > request clearance, sign electronically | Request appears in My Requests as **Submitted**; employee page shows the strip, coloured last-day badge and "What happens next" |
| A2 | HRBP: Clearance Requests > **Start clearance** for another employee | New request, "Raised by HR" |
| A3 | HRBP: sidebar | **Clearance** and **HR Management** show a red count (requests to forward) |
| A4 | HRBP: Clearance landing | **Clearance to forward** card shows a red "N to forward" |
| A5 | HRBP: Clearance Requests, **To forward** tab | Only Submitted requests; tab shows the red count |

## B. Forwarding

| # | Steps | Expected |
|---|---|---|
| B1 | Open a Submitted request | "Ready to forward?" box: green when all signers are set, amber with the missing parts otherwise |
| B2 | Forward one request | Status **In Clearance**; every signer gets a bell notification + email |
| B3 | Request on a site with no Accounts signer, forward | Accounts is **skipped by itself** ("No signer is set…"), the rest forwarded |
| B4 | Request with no **HR** signer, forward | Not forwarded; error says the HR signer is missing |
| B5 | To forward tab: tick 2–3 requests > **Forward selected** | "N forwarded"; failed ones listed with the reason and stay ticked |
| B6 | HRBP: Skip a part, then Undo | Step shows skipped / back to waiting; HR cannot be skipped |

## C. Signing a part (Admin, Store, Accounts, Dept Head)

| # | Steps | Expected |
|---|---|---|
| C1 | Signer: sidebar | Clearance and My Tasks show counts; **Clearance to sign** card shows "N waiting for you" |
| C2 | Open the part | One row per line; hints like "(if any)" in small grey under the line |
| C3 | Click ✓ / ✗ / N/A; click the chosen one again | Chosen one turns soft blue; clicking again clears it |
| C4 | **Mark all {word}** | Only empty lines become ✓; lines already ✗ or N/A unchanged |
| C5 | Choose ✗ | Remarks pop-up opens by itself; 💬 turns red until a reason is typed; footer counts it |
| C6 | Change answers | **Save answers** bar appears and sticks to the bottom; disappears after saving |
| C7 | Try to Sign with unsaved answers | Sign disabled, "Save your answers first." |
| C8 | Save, tick the confirmation, **Confirm and sign** | Green **"✓ Signed…"** pop-up bottom right; part locked with "Signed by …" |
| C9 | ⓘ / Signatures button on the employee strip | Signature stepper pop-up; closes on click outside |

## D. HR part (HRBP)

| # | Steps | Expected |
|---|---|---|
| D1 | Open the HR part while others are still open | Wizard: Line manager > HR details > Checklist & sign; Sign blocked "HR signs last…" |
| D2 | Choose the line manager | Line manager gets a notification; "Complete data received" shows "Waiting: line manager" |
| D3 | Line manager: My Requests > confirm | The HR line fills by itself |
| D4 | HR details: fields in an even grid; save | Saved; last working date must be after joining date |
| D5 | **Handing over to** / **Email forwarding to**: type 2+ letters | Live list of employees; pick one → blue chip "Name (code)"; "Use '…'" keeps typed text |
| D6 | After every other part is signed: sign HR | Request **Completed** |

## E. IT part (IT Lead + IT staff)

| # | Steps | Expected |
|---|---|---|
| E1 | IT Lead: open IT part | Checklist + **Assets still assigned** card |
| E2 | 👤 on a line > pick IT staff | Initials appear; IT staff gets bell + email |
| E3 | IT staff: My Tasks / My clearance tasks | The line is listed; answering it shows ✓ on the lead's initials |
| E4 | Lead: reopen 👤 > **Take back** | Line is the lead's again |
| E5 | ⓘ next to an asset | Details panel (S/N, since, condition); closes on click outside |
| E6 | **Return** > popup > Returned / condition > Record return | Asset leaves the list; IT Inventory shows it Unassigned |
| E7 | Return > "mark it Lost" without a remark | Mark lost disabled; 💬 red |
| E8 | Try to Sign with an asset still assigned | Sign blocked with the asset count |

## F. Reminders (needs talha_hr_0014 + the cron job)

| # | Steps | Expected |
|---|---|---|
| F1 | In SQL: `select hr.clearance_reminder_sweep();` on a case forwarded > 3 days ago | Returns the number sent; waiting signers get "Reminder: clearance to sign…" |
| F2 | Run it again the same day | Returns 0 (once every 3 days per part) |
| F3 | HR part while others are open | HR not reminded |
| F4 | Request page / Clearance to sign | Waiting parts show amber **⏰ Overdue · N days** |

## G. HRBP request page and list

| # | Steps | Expected |
|---|---|---|
| G1 | Request page | Employee strip, horizontal Progress, forms with answer tags |
| G2 | A fully answered form | Folds into one line "✓ 5/5"; click opens it |
| G3 | **Print form** | 3 A4 pages; page 1 ticks only; handover / email forwarding from HR details |
| G4 | List | Tabs with counts, "3/5 signed" bar, coloured last-day badge |
| G5 | Cancel a request | Status Cancelled; reason shown; signers can no longer sign |

## H. Everywhere

| # | Steps | Expected |
|---|---|---|
| H1 | Round ← back buttons on every clearance screen | Go to the right parent page |
| H2 | Phone width (DevTools, 375 px) | Clearance to sign shows cards, no sideways scrolling; strips wrap |
| H3 | Empty lists | Icon + one line (🎉 / ✍️ / 🔍) |
| H4 | Errors | Always shown inline, never in the URL |
