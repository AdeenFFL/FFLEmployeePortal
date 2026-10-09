**FAUJI FOOD VERTICAL**

Centralized Employee Portal Project

**Business Requirements Document**

**Fair Price Shop (FPS) Module — AS-IS Process**

*Document Status: Draft for review — AS-IS baseline (input to To-Be design)*

Prepared by: IT / DX Team

Date: 3 September 2026

# Document Control

| Field | Detail |
| --- | --- |
| Document Title | BRD — Employee Portal: Fair Price Shop (FPS) Module — AS-IS Process |
| Version | 0.1 (Draft) |
| Prepared By | IT / DX Team |
| Module Owner | IT / DX Team (FPS & Mess Management System workstream) |
| Scope of This Version | Fair Price Shop AS-IS process only, based on the Fauji Foods Dairy Plant site |
| Out of Scope (this version) | Mess Management System AS-IS (to be added once process inputs are received); To-Be design (subsequent phase) |
| Status | Draft — pending inputs from other sites/functions before To-Be design |

# 1. Overview

## 1.1 Purpose of this Document

This Business Requirements Document (BRD) captures the current ("AS-IS") business process, data inputs, and outputs for the Fair Price Shop (FPS) function, as the first step toward designing the FPS module of the centralized Employee Portal. It is intended to be reviewed and supplemented with inputs from other sites and functions, after which it will form the baseline for the To-Be process design.

## 1.2 Organizational Background

Fauji Food Vertical comprises four sub-companies — Fauji Foods Limited, Fauji Fresh n Freeze, Fauji Cereals, and Fauji Pasta — operating across multiple plant sites, supported by a shared Head Office. Each company manufactures its own specific range of products at its respective site(s). The vertical's workforce spans three employment types: Permanent, Contractual, and 3rd Party — of which Permanent and Contractual staff are issued official M365 accounts, while 3rd Party staff are not.

## 1.3 Project Background

The IT Team has initiated a project to develop a centralized Employee Portal, comprising multiple modules to be built first as standalone solutions and later integrated into a single portal. Planned modules include HR, Health & Safety, Quality Assurance, Admin, IT Service Management, Inventory Management, and future workstreams as they arise. The Fair Price Shop (FPS) Solution and the Mess Management System have been assigned for end-to-end development, documentation, and launch as part of this initiative.

## 1.4 Scope of this Document

This document covers the AS-IS Fair Price Shop process only. The Fair Price Shop allows manufactured products to be sold to both employees (at a discounted Employee Rate) and the general public (at a General Public Rate); each site's shop stocks its own company's products as well as products from the other Fauji Food Vertical companies, and is run by a single Shop Manager.

*Note: Of all FPS locations across the four companies, plants, and Head Office, only the Fauji Foods Dairy Plant site currently follows the semi-digitized (Excel-based) process described in this document. At every other site — including Head Office — the Fair Price Shop is managed entirely on paper. This document reflects the Dairy Plant site's process as the most mature reference point available; process variations at other sites will need to be captured separately before the To-Be design is finalized.*

The Mess Management System AS-IS process will be documented in a subsequent update to this BRD once the relevant process details are shared.

## 1.5 Objective of this Phase

- Establish a single, agreed record of how the Fair Price Shop currently operates, including all stakeholders, steps, data captured, and documents produced.
- Provide a fields/data inventory that can be mapped directly to future system entities and forms.
- Provide an inventory of currently generated documents and reports, to be preserved or improved in the To-Be design.
- Serve as the baseline that will be enriched with inputs from other sites and stakeholders, ahead of To-Be process design.

# 2. AS-IS Process — Fair Price Shop

Applicability: The process below applies to the Fauji Foods Dairy Plant site. It covers demand raising and approval, stock receiving, sale to employees and to the general public, credit settlement via salary deduction, and day-end closing and reporting.

## 2.1 Stakeholders

| Stakeholder | Scale / Location | Role in the FPS Process |
| --- | --- | --- |
| Shop Manager | 1–2 per site | Owns day-to-day shop operations: raises the stock demand sheet, receives stock, updates rate/stock sheets, manages employee & GP sales, prepares cash memo and daily sales report, initiates cash handover, and requests credit salary deductions from HR/Payroll. |
| Sales Manager | Per company | Reviews and approves the Shop Manager's stock demand sheet by email before stock can be issued. |
| Consumer Sales Manager | Per company | Copied on demand-approval emails as an oversight stakeholder for consumer/FPS sales. |
| Consumer Sales Officer | Per company | Prepares the Loading Slip once the Sales Manager approves the demand, and hands it to the Warehouse Supervisor. |
| Warehouse Supervisor | Per warehouse/site | Issues the approved stock against the Loading Slip and provides the Delivery Challan and Sales Tax Invoice to the Shop Manager. |
| Finance Officer | Head Office | Copied on stock demand emails; the Finance/Accounts function also decides and communicates the Employee Rate and General Public resale rates. |
| Head Admin | Head Office | Copied on stock demand emails; receives signed copies of the Daily Sales Report and Cash Handover Receiving Note. |
| Deputy Manager (DM) Admin | Per site | Copied on stock demand emails; reviews and signs the Daily Sales Report. |
| Admin Supervisor | Per site | Copied on stock demand emails; reviews and signs the Daily Sales Report. |
| Gate Personnel | Per site | Signs off on stock received at the site gate (Gate Clerk Signature on the Delivery Challan); wider role in the FPS process to be detailed in a later phase. |
| Cashier | Per site | Signs the Daily Sales Report, accepts cash handover from the Shop Manager, and issues a cash handover receiving. |
| HR | Head Office | Receives the Shop Manager's monthly credit-deduction request email and actions the salary deduction for the employee. |
| Payroll / Finance Team | Head Office | Copied on the monthly credit-deduction request email; processes the deduction as part of running payroll. |
| Employees | All sites | Purchase products at the discounted Employee Rate, subject to a monthly purchase limit per product; may pay cash or on credit, optionally recovered via salary deduction. |
| General Public / Customers | All sites | Purchase products at the General Public Rate, subject to a daily purchase limit per product; cash only. |

## 2.2 High-Level Process Flow

## 2.3 Demand Raising & Approval

When product(s) are needed at the Fair Price Shop, the Shop Manager prepares a Stock Demand Sheet in Excel, listing the Product Code, Product Description, Required Quantity, Unit of Measurement, and any other relevant product details. The Shop Manager emails the completed demand sheet to the Sales Manager for approval, copying six other stakeholders: Head Admin, Deputy Manager (DM) Admin, Admin Supervisor, Finance Officer, Consumer Sales Manager, and Consumer Sales Officer.

The Sales Manager reviews the demand and replies to the email with approval. No other step, check, or system is involved in this approval — it is a single free-text email exchange.

## 2.4 Stock Receiving from Warehouse

Once the Sales Manager's approval is received, the Consumer Sales Officer prepares a Loading Slip based on the approved demand and provides it to the Warehouse Supervisor. The Warehouse Supervisor prepares and hands over the requested stock to the Shop Manager against the approved Loading Slip, along with two supporting documents generated by FFL's system:

- Delivery Challan — confirms the products, quantities, batch/expiry dates, and vehicle details of the stock physically dispatched, and includes a table for the Shop Manager to note any damages or shortages found on receipt, which is signed off by the driver, the Gate Clerk, and the Shop Manager (Customer Signature/Stamp).
- Sales Tax Invoice — a system-generated invoice showing the MRP, Ex-Factory Rate, Value Excl. GST, GST rate and amount, and Net Invoice Value for the stock supplied, referencing the same delivery via its G.T.N. Number.

The Shop Manager takes the received stock into the shop's inventory and updates the Product Details sheet (current rate and rate history) and the Stock Receiving sheet, using the rate shown on the Sales Tax Invoice and adding the new quantity to the previous closing balance to arrive at an updated current balance per product.

*Note: The Employee Rate and General Public Rate at which stock is resold are decided separately by Head Office Finance/Accounts and are not derived from, or linked to, the cost price and GST shown on the Sales Tax Invoice — the two pricing layers are maintained independently (see Gap G13).*

*Note: As with the previous version of this document: once updated, the newer resale price applies to the entire current stock balance for that product — both the previously held stock and the newly received stock — rather than being tracked separately by receipt batch, even though the Sales Tax Invoice already provides a batch-specific cost rate at the point of receipt (see Gap G6).*

## 2.5 Employee Sale Process

Employee purchase limits are set on a monthly basis: a monthly limit is defined per product, and employees may not purchase quantities beyond this limit. Limit compliance is tracked manually by the Shop Manager.

Employees can request products by phone, WhatsApp, or in person at the shop. On request, the Shop Manager checks product availability and the employee's remaining monthly limit. If stock is available, it is handed over along with a handwritten invoice at the current Employee Rate, and the Shop Manager records the transaction (quantity and price) in the Cash Memo. The employee chooses to pay by cash or credit:

- Credit: the employee opts for salary deduction, or settles the outstanding balance in cash monthly (see Section 2.6 for the credit settlement process).
- Cash: the employee pays upfront and the payment is recorded in the Cash Memo.

## 2.6 Credit Settlement & Salary Deduction Process

Employees who purchase on credit may optionally have the outstanding amount deducted from their salary. The deadline for communicating the credit amount (or any remaining unpaid balance) is the 20th of each month. Ahead of this deadline, the Shop Manager sends an email to HR, with the Payroll/Finance team (the team responsible for preparing salaries) copied in, listing the employees and amounts to be deducted. HR/Payroll then applies the deduction to the respective employee's salary for that month.

## 2.7 General Public Sale Process

General Public purchase limits are enforced on a daily basis, per product, and compliance is tracked manually by the Shop Manager — currently from memory, recording only the customer's name; no CNIC or phone number is captured.

Customers purchase in person only. On request, the Shop Manager checks stock availability and the customer's remaining daily limit. If stock is available, it is handed over with a handwritten invoice at the current General Public Rate, and the transaction is recorded in the same Cash Memo used for employee sales. General Public sales are cash-only.

## 2.8 Day-End Closing & Reporting

At day end, the Shop Manager generates a single Daily Sales Report covering both employee and general public sales, with subtotals and grand totals for each, compiled from the Cash Memo. This report is signed by the Shop Manager, the Admin Supervisor, and the DM Admin, then shared with the Cashier for signature. Once signed, the Shop Manager initiates the cash handover to the Cashier, who issues a receiving for the cash. Signed copies of both the Daily Sales Report and the Cash Handover Receiving are shared with Head Admin, the Admin Supervisor, and the DM Admin.

# 3. Fields & Data Currently Captured (Inputs)

The following inventory lists the data currently captured across the demand, receiving, rate, and sales workflows, based on the Excel workbooks maintained at the Dairy Plant site. Each entry represents a distinct manual register/sheet in the current process.

### 3.1 Product Rate List ("Sheet1" / "Product Details")

Master list of sellable products and the two selling prices, plus full price-revision history. Maintained in Excel by the Shop Manager based on rates communicated by Head Office Accounts.

- S No
- Item Code
- Product Name
- Employee Rate (PKR)
- General Public Rate (PKR)
- Rate Effective Date
- Historical Rate blocks (repeated per revision date)

### 3.2 Employee Master List

Reference list of employees eligible for Employee Rate purchases and monthly-limit tracking, sourced from HR data.

- S No
- P No. (Personnel Number)
- Employee Name
- Designation
- Department
- Section
- Job Type (Permanent / Contractual / 3rd Party)

### 3.3 Stock Demand Sheet (Excel)

Prepared by the Shop Manager in Excel when stock is required, and emailed to the Sales Manager for approval, with Head Admin, Deputy Manager Admin, Admin Supervisor, Finance Officer, Consumer Sales Manager and Consumer Sales Officer copied in.

- Product Code
- Product Description
- Required Quantity
- Unit of Measurement
- Other relevant product details (where applicable)
- Date raised

### 3.4 Sales Manager Approval (Email)

Free-text email reply from the Sales Manager approving the stock demand; this approval triggers the Consumer Sales Officer to prepare a Loading Slip.

- Reference to the original demand email
- Approval statement (free text)
- Date/time of approval
- Approver name

### 3.5 Loading Slip

Prepared by the Consumer Sales Officer once the demand is approved, and handed to the Warehouse Supervisor to authorize stock issuance.

- Loading Slip reference
- Product
- Approved Quantity
- Date
- Prepared By (Consumer Sales Officer)
- Warehouse / Shipping Point

### 3.6 Delivery Challan (Warehouse → Shop)

Document issued by the Warehouse Supervisor at the point of stock issuance, confirming what was physically dispatched to the shop; includes a shortages/damages table for the Shop Manager to complete on receipt.

- Delivery Number
- PO / Order Number & Date
- Shipping Point & Location
- Shipment Number & Delivery Date
- Vehicle Size & Registration No.
- Gross Weight
- Customer Code & Name (Shop)
- Product Code & Description (per line)
- Delivery Quantity & Gross Weight (per line)
- Batch Expiry Date (per line)
- Damages/Shortages Qty (per product, if any)
- Driver Name/CNIC, Gate Clerk Signature, Customer Signature/Stamp

### 3.7 Sales Tax Invoice (Warehouse/FFL → Shop)

System-generated invoice accompanying the Delivery Challan, capturing the cost value, MRP, and GST charged for stock transferred to the shop — a separate pricing layer from the Employee/General Public resale rates.

- Invoice Number
- G.T.N. Number & Date (links to Delivery Challan)
- Customer Name & Address
- S.T. Reg No. / NTN
- Product Description & Quantity
- MRP
- Ex-Factory Rate
- Value Excl. GST
- GST Rate (%) & GST Amount
- Net Invoice Value

### 3.8 Stock Receiving Sheet

Updated by the Shop Manager on receiving stock from the Warehouse Supervisor, using the Delivery Challan and Sales Tax Invoice as source documents; adds the new quantity to the previous closing balance.

- S No
- Date
- Product
- Quantity Received
- Rate (from Sales Tax Invoice)
- Amount
- Expiry Date
- Previous Closing Balance
- Recent / Updated Stock Balance
- Delivery Challan / Invoice Reference

### 3.9 Cash Memo (Point of Sale capture)

Excel workbook updated live at the point of sale for every employee, general public, and internal (e.g. Mess) transaction.

- Transaction Date
- Customer Type (Employee / General Public / Mess)
- Customer / Employee Name
- P No. (for employees)
- Product
- Unit Price
- Quantity
- Amount
- Payment Mode (Cash / Credit)

### 3.10 Sales Transaction Log ("Stock Sale Detail")

Line-level record of every sale transaction, used to derive daily and monthly running totals.

- S No
- Customer Type
- Date
- P No.
- Customer / Employee Name
- Product
- Quantity
- Price
- Unit of Measure (Packet / Carton)
- Amount
- Running Daily Total
- Running Monthly Total

### 3.11 Credit Transaction Log ("Credit List")

Captures employee purchases made on credit, for monthly recovery via salary deduction or cash settlement.

- S No
- Customer Type
- Date
- P No.
- Employee Name
- Designation
- Department
- Job Type
- Product
- Quantity
- Price
- Unit of Measure
- Amount

### 3.12 Credit Settlement / Salary Deduction Request (Shop Manager → HR)

Monthly email sent by the Shop Manager to HR, with the Payroll/Finance team copied in, listing employees whose outstanding credit balance is to be deducted from salary; must be sent ahead of the 20th-of-the-month deadline.

- Employee P No.
- Employee Name
- Outstanding Credit Amount
- Month / Period
- Request Date (before the 20th)

### 3.13 General Public Purchase Tracking

No structured fields are captured; the Shop Manager tracks daily purchase-limit compliance from memory, recording only the customer's name against the sale.

- Customer Name (recorded informally; no CNIC / phone number captured)

### 3.14 Cash Handover Record

Confirms cash collected during the day has been handed to the Cashier.

- Date
- Amount Handed Over
- Shop Manager (signatory)
- Cashier (signatory / receiving issued)

# 4. Documents & Reports Currently Generated (Outputs)

The table below inventories the documents and reports produced by the current process, all of which are candidates for replication (and automation) in the To-Be system.

| Document / Report | Frequency | Prepared By | Shared With | Format | Purpose |
| --- | --- | --- | --- | --- | --- |
| Sale Receipt / Invoice | Per transaction | Handwritten by Shop Manager | Employee or GP customer | Handwritten | Confirms product, quantity, and price sold at Employee or General Public Rate. |
| Loading Slip | Per approved demand | Consumer Sales Officer | Warehouse Supervisor | Paper / print | Authorizes the Warehouse Supervisor to release the approved stock quantities. |
| Delivery Challan | Per stock delivery | Warehouse Supervisor (FFL system) | Shop Manager (Customer Copy) | Print, signed | Evidences products, quantities, batch/expiry and vehicle details physically delivered; signed by driver, gate clerk and Shop Manager, with a shortages/damages table. |
| Sales Tax Invoice | Per stock delivery | FFL system (Warehouse) | Shop Manager | System-generated print | Confirms the cost value, MRP and GST charged by FFL for stock transferred to the shop. |
| Employee Cash Memo | Continuous / daily | Shop Manager | Retained at shop; feeds Daily Sales Report | Excel | Running log of employee and GP sales used to compile the day's totals. |
| Employee Monthly Bill | Monthly | Shop Manager (from Credit List) | Employee (for credit recovery) | Excel / print | Statement of an employee's outstanding credit purchases to be settled or salary-deducted by month end. |
| Credit Deduction Request Email | Monthly (before the 20th) | Shop Manager | HR, cc Payroll/Finance team | Email | Requests salary deduction of an employee's outstanding credit balance for the month. |
| Daily Sales Report | Daily | Shop Manager | Admin Supervisor, DM Admin, Cashier, Head Admin (after signatures) | Excel / print, signed | Sales summary for Employee and GP sales with subtotals and grand totals, derived from the Cash Memo. |
| Cash Handover Receiving Note | Daily | Cashier | Shop Manager, Head Admin, Admin Supervisor, DM Admin | Paper, signed | Confirms cash collected during the day has been received by the Cashier from the Shop Manager. |
| Stock Report | Periodic (as updated) | Shop Manager | Internal shop record | Excel | Product-wise recent stock, employee/GP sales, returns to QA, closing balance and credit balance. |
| Sold Products Summary | Daily / to-date | Shop Manager | Internal shop record | Excel (pivot) | Aggregated view of products sold, by employee and by date. |
| Credit Summary | Periodic | Shop Manager | Internal / Finance reference | Excel (pivot) | Product-wise quantity and amount outstanding on credit. |
| Overall Sales Summary | Periodic (monthly/yearly) | Shop Manager | Internal / Head Office reference | Excel (pivot) | Product-wise quantity and amount sold across all customer types over a selected period. |

# 5. Key Observations (AS-IS)

These observations are noted for reference during To-Be design and do not require action at this stage.

- Of all Fair Price Shop sites across the four companies and Head Office, only the Fauji Foods Dairy Plant site currently runs this semi-digitized, Excel-based process; all other sites operate the Fair Price Shop entirely on paper, including demand, receiving, sales, and reporting.
- There is no single system of record: demand, rates, stock, sales, and credit each live in separate Excel sheets/workbooks and emails maintained manually by the Shop Manager, with no automated linkage between them.
- Stock demand is approved via a free-text email reply from the Sales Manager, cc'ing six other stakeholders, with no structured approval status or defined turnaround time.
- The Stock Demand Sheet, Loading Slip, Delivery Challan, and Sales Tax Invoice each carry independent reference numbers with no linkage back to the original demand, making fulfillment status hard to track — especially when one demand is fulfilled through multiple separate deliveries.
- Employee monthly purchase limits and General Public daily purchase limits are enforced manually by the Shop Manager, relying on memory for General Public customers since no CNIC or phone number is captured for them.
- A price change is applied retroactively to the entire current stock balance (old and new combined) rather than being tracked against the batch/lot it was originally received at, even though the Sales Tax Invoice already captures a batch-specific cost rate at receipt.
- The cost price at which stock is transferred from FFL to the shop (captured on the Sales Tax Invoice, inclusive of GST) is maintained entirely separately from the Employee/General Public resale rates, with no linked visibility between the two.
- Credit settlement for salary deduction is handled via a manual monthly email from the Shop Manager to HR (cc Payroll/Finance), ahead of a 20th-of-month deadline, with no structured format or confirmation loop back to the shop.
- Multiple manual, physical sign-off steps (Shop Manager, Admin Supervisor, DM Admin, Cashier) are required to close and report each day's sales and to hand over cash.

# 6. Gap Analysis

The observations in Section 5 are restated below as discrete, measurable gaps. Each gap includes a baseline indicator that can be measured against the current process, and a target outcome the To-Be process should be designed to satisfy. This table is intended to be used directly as a checklist during To-Be design, to confirm each gap has been addressed.

| ID | Category | Current Gap (AS-IS) | Business Impact / Risk | Measurable Indicator (Baseline) | Target Outcome (To-Be) |
| --- | --- | --- | --- | --- | --- |
| G1 | Process Standardization | Only the Dairy Plant site runs this (semi-digitized) process; every other FPS site — including Head Office — is fully paper-based. | Inconsistent controls and reporting quality across sites; portal cannot be designed around a single assumed process. | % of FPS sites operating on a common, documented process (currently 1 of multiple sites) | 100% of FPS sites operating on one standardized process before system rollout |
| G2 | System Fragmentation | Demand, rates, stock, sales, and credit each live in separate, disconnected Excel workbooks maintained manually. | Data entered multiple times; high risk of mismatched figures between sheets; no single source of truth. | Number of separate registers/files required per site to complete one sales cycle (currently 6+) | 1 integrated system of record per site; 0 manual cross-sheet updates per transaction |
| G3 | Inventory Visibility | Stock availability is verified informally by phone/visit between Shop Manager, Sales Officer, and Warehouse Manager rather than a shared live view. | Delays in confirming availability; risk of overselling or unnecessary customer turn-away. | Average time to confirm stock availability for a demand (currently informal / untimed) | Availability confirmed in under 1 minute |
| G4 | Employee Purchase Limit Control | Employee monthly limits per product are tracked manually by the Shop Manager, with no system check at point of sale. | Limit breaches may go undetected until manual reconciliation; inconsistent enforcement across shop managers. | Number of limit-breach incidents per month not caught until reconciliation (currently untracked) | 0 limit breaches at point of sale; system blocks/flags any purchase exceeding the monthly limit |
| G5 | General Public Identification & Limit Control | GP customers are tracked from memory using name only; no CNIC/phone captured; daily limits enforced manually. | Daily limits can be bypassed by customers using different names; no ability to verify or audit repeat purchases. | % of GP transactions with a unique, verifiable customer identifier (currently 0%) | 100% of GP transactions linked to a CNIC/phone-verified customer record; daily limits enforced automatically |
| G6 | Price Change Traceability | A price revision is applied retroactively to the entire current stock balance, both old and newly received stock, with no batch/lot-level rate tracking. | Potential margin/costing inaccuracy; inability to audit which rate applied to which received batch. | % of stock valued at batch-accurate rate at any point in time (currently 0%, blended rate applied) | 100% of stock traceable to its receipt batch and the rate applicable at receipt, where required by Finance |
| G7 | Credit Recovery & Payroll Integration | Credit sales are recovered via a manual monthly email from the Shop Manager to HR (cc Payroll/Finance) ahead of a 20th-of-month deadline, with no structured file/format and no system link to payroll. | Deadline compliance depends on the Shop Manager remembering to send the email; unvalidated free-text figures risk incorrect deductions; no confirmation loop back to the shop that a deduction was actually applied. | Number of credit-deduction emails sent after the 20th deadline per month; number of deduction discrepancies reported by employees (currently untracked) | 100% of credit deduction requests submitted through a structured, auditable workflow ahead of the monthly cutoff, with confirmation of amounts actually deducted |
| G8 | Demand Approval Workflow | Stock demand is approved via a free-text email reply from the Sales Manager, with no structured approval status, no defined turnaround SLA, and a broad six-person CC list with no differentiated role for each recipient. | No visibility into pending vs. approved vs. rejected demands; unclear accountability among CC'd stakeholders; risk of a demand being missed in a crowded inbox. | Average time from demand sent to Sales Manager approval received (currently untracked); % of demand emails with a documented approval/rejection reason (currently 0%) | 100% of demand requests tracked through defined states (Submitted/Approved/Rejected) with a visible SLA and a single accountable approver |
| G9 | Day-End Closing Cycle Time | Daily Sales Report requires 4 sequential physical/manual sign-offs (Shop Manager, Admin Supervisor, DM Admin, Cashier) before cash handover is complete. | Delayed visibility of daily sales and cash position to Head Office; risk of end-of-day bottlenecks. | Average time from shop close to a fully signed Daily Sales Report and completed cash handover (currently untracked, multi-step manual) | Same-day close with digital approvals; target closing cycle under 30 minutes from last sale |
| G10 | Data Reconciliation Effort | Sales, stock, credit, and cash figures are compiled manually from the Cash Memo into multiple separate pivot reports (Stock Report, Sold Products, Credit Summary, Overall Summary). | Significant recurring manual effort; higher risk of reporting errors and inconsistent figures across reports. | Person-hours per week spent manually compiling/reconciling reports (currently untracked, multiple pivots) | Reports generated on-demand from a single data source; 0 person-hours spent on manual pivot reconciliation |
| G11 | Auditability of Records | Invoices and several reports (sale receipt, cash handover note) are handwritten or signed on paper, with copies distributed manually. | Risk of lost/illegible records; no tamper-evident trail; slow retrieval for audit or dispute resolution. | % of FPS transactions with a digital, timestamped, tamper-evident record (currently 0%) | 100% of transactions and approvals captured with a digital audit trail (who/what/when) |
| G12 | Demand-to-Delivery Traceability | The Stock Demand Sheet, Loading Slip, Delivery Challan and Sales Tax Invoice each carry their own separate reference numbers with no linkage back to the original demand; one demand can be fulfilled through multiple, separately numbered deliveries. | Shop Manager cannot easily confirm whether a demand has been fully, partially, or not yet fulfilled; risk of under-ordering or duplicate follow-up demands. | % of stock deliveries traceable back to their originating demand reference (currently 0%, no shared reference field) | 100% of deliveries linked to their originating demand, with a visible fulfilled-vs-outstanding quantity per line item |
| G13 | Cost vs. Resale Pricing Linkage | The Sales Tax Invoice captures the cost price (MRP, Ex-Factory Rate, GST) at which stock is transferred from FFL to the shop, but this is not linked in any record to the Employee Rate / General Public Rate at which the same stock is resold. | No visibility into per-product margin or subsidy level at the shop; Head Office cannot easily verify resale rates remain appropriate relative to current cost. | % of received stock with both cost price and resale rate visible in a single record (currently 0%) | 100% of stock lines showing cost price and both resale rates together, enabling margin/subsidy visibility per product |
| G14 | Document Format Consistency | The Delivery Challan and Sales Tax Invoice are system-generated by FFL's ERP environment (structured, consistent), while the Stock Demand Sheet, Loading Slip, and Credit Deduction Request remain free-form Excel/email documents. | Harder to build reliable system integrations when only part of the document chain is structured; manual re-keying likely needed to link ERP-issued documents to FPS records. | % of documents in the demand-to-receipt-to-credit chain that are structured/system-generated (currently ~2 of 8 document types) | 100% of documents in the chain captured or generated through the Employee Portal in a structured format |

# 7. Open Items

This section lists items that remain open — either because they require clarification/decisions from stakeholders, or because a required data format does not yet exist in the current process. These should be resolved or explicitly deferred before To-Be design is finalized.

## 7.1 Open Process & Clarification Items

- The Gate Personnel stakeholder appears to align with the "Gate Clerk Signature" field on the Delivery Challan, but the full scope of Gate Personnel's involvement in the wider FPS process (e.g. GP customer entry, other gate-related checks) is still not documented.
- Approval/rejection criteria the Sales Manager applies when reviewing a stock demand (e.g. budget, stock availability, seasonality) are not documented — approval today is a free-text email response with no defined criteria or SLA.
- How the Loading Slip, Delivery Challan and Sales Tax Invoice are matched back against the original Stock Demand Sheet to confirm full or partial fulfillment is not documented.
- Process for handling partial or split deliveries against a single demand (observed in the sample documents, where a single 7-line demand appears to have been fulfilled via at least two separately numbered deliveries) is not documented.
- Follow-up process for shortages or damages noted in the Delivery Challan's shortages/damages table (e.g. credit note, replacement, price adjustment) is not documented beyond the note being recorded on the challan itself.
- AS-IS process for Fair Price Shops at all other sites (currently fully paper-based) has not yet been captured — needs confirmation of whether it mirrors the Dairy Plant steps or differs.
- Mess Management System AS-IS process has not yet been shared and is not covered by this document.
- The business rule for how monthly Employee limits and daily General Public limits are set/revised per product (who decides, how often, how communicated to sites) is not documented.
- "Return to QA" — referenced as a column in the Stock Report — is not explained in the process narrative; the trigger, approval, and documentation for returning stock to QA is unclear.
- "Mess" appears as a distinct customer type in the Cash Memo (i.e. the Mess buys products from the FPS); the relationship between this internal consumption and the separate Mess Management System workstream needs to be clarified.
- It is not documented whether/how the Shop Manager reconciles the Cash Memo total against physical cash on hand before handover, beyond the Cashier's receiving.
- Whether credit settlement/salary deduction is a standing employee preference or a per-purchase choice, and how that preference is captured, is not documented — the process only states it is "optional."
- Treatment of credit balances not communicated to HR/Payroll by the 20th deadline (carried forward, penalized, or blocked from further credit) is not documented.
- How the cost price on the Sales Tax Invoice feeds into (or is reconciled against) the Employee Rate / General Public Rate set by Finance is not documented.

## 7.2 Missing Data In/Out Formats Required

The following data formats are either undocumented/non-standardized in the current process, or do not exist at all today and will need to be jointly defined with the relevant function before system design — including the credit settlement format the Shop Manager will need to share with Finance/Payroll.

| Data Item | Current AS-IS State | Fields/Format Needed | To Confirm With |
| --- | --- | --- | --- |
| Credit Settlement File (Shop Manager → HR/Payroll) | Currently only an informal email from the Shop Manager to HR (cc Payroll/Finance) ahead of the 20th-of-month deadline; no standard template, required fields, or confirmation-of-deduction step. | P No., Employee Name, Department, Credit Period (Month/Year), Opening Credit Balance, Purchases During Period, Amount Settled in Cash, Net Amount for Salary Deduction, Shop Manager Confirmation, Payroll Confirmation of Amount Deducted | HR / Payroll / Finance |
| Stock Demand Sheet | Exists as an Excel sheet per company with reasonably consistent fields, but approval and CC routing is manual email and not standardized into a trackable workflow. | Demand ID, Site, Company, Product Code, Product Description, Required Qty, UoM, Date Raised, Requested By, Approval Status | Sales Manager / Consumer Sales Officer |
| Loading Slip | Prepared manually by the Consumer Sales Officer after approval; not currently shared with or retained by the Shop Manager as a record. | Loading Slip No., Date, Demand Reference, Product, Approved Qty, Warehouse, Prepared By | Consumer Sales Officer / Warehouse Supervisor |
| Demand-to-Delivery Reconciliation | Not tracked; Delivery Challan and Sales Tax Invoice numbers are not cross-referenced back to the originating demand. | Demand Reference No., Loading Slip No., Delivery Challan No., Invoice No., Ordered Qty, Delivered Qty, Fulfillment Status | Consumer Sales Officer / Warehouse Supervisor / Shop Manager |
| Rate/Price Circular (Head Office Accounts → Sites) | Communicated informally to sites; no standard document/format captured. | Effective Date, Product, Employee Rate, General Public Rate, Approved By | Finance / Accounts (Head Office) |
| General Public Customer Record | Not currently captured in any structured format; only a name is remembered by the Shop Manager. | Customer Name, CNIC, Phone Number, Daily Purchase History (system-tracked) | Admin / Shop Managers |
| Return to QA Record | Referenced as a column in the Stock Report but no input form or approval format exists. | Date, Product, Quantity Returned, Reason, Approved By | Quality Assurance / Shop Managers |
| Cash Handover Receiving Note | Currently a paper, unstructured note signed by the Cashier. | Date, Amount Handed Over, Shop Manager, Cashier, Reference to Daily Sales Report | Cashier / Finance |
| Batch/Lot-Level Rate Retention | The Sales Tax Invoice already captures MRP, Ex-Factory Rate and GST per product at receipt, but this is not retained against the specific stock batch in the Stock Receiving/Product Details sheets — a blended current-balance rate is used instead (see Gap G6). | Receipt Batch No., Receipt Date, Quantity, Cost Rate at Receipt (from Sales Tax Invoice), Product | Finance / Shop Managers |

# 8. Next Steps

- Circulate this AS-IS baseline for review and validation by the Shop Manager(s) and Admin stakeholders at the Dairy Plant site.
- Collect AS-IS process details for Fair Price Shops at all other sites currently operating on paper, to confirm whether the same process (manually executed) applies or whether variations exist.
- Collect and document the Mess Management System AS-IS process, to be appended to this BRD.
- Use this consolidated AS-IS baseline, together with inputs from other functions, to design the To-Be process for both the FPS and Mess modules.
- Use the Gap Analysis table (Section 6) as a design checklist — each gap should be explicitly mapped to a corresponding To-Be capability before the design is finalized.
- Resolve the Open Items (Section 7) — in particular, agree the Credit Settlement format with Finance/Payroll — before finalizing the To-Be data model.
