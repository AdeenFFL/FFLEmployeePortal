// Hand-written types mirroring supabase/migrations/0001-0019: the persons/user_accounts/
// user_roles identity split, the base-skeleton strip (0009), then roles -> permissions directly
// via role_permissions (0019_direct_role_permissions.sql — replaced an earlier permission_groups
// indirection layer that turned out to never actually group anything). Shaped to match what
// `supabase gen types typescript` would produce
// (Row/Insert/Update/Relationships per table). No live-generated types exist yet. Once
// convenient, replace this file with the output of:
//   npx supabase gen types typescript --project-id <ref> > types/database.ts
//
// NOTE: these must stay `type` aliases, not `interface` declarations — interfaces don't get the
// implicit index signature TS needs to satisfy supabase-js's `Record<string, GenericTable>`
// constraint, which silently degrades every `.from(...)` call's inferred row type to `never`.

export type UserStatus = "Active" | "Inactive" | "Suspended";
export type OrgUnitType = "Department" | "Site";
export type OrgUnitSiteType = "plant" | "warehouse" | "shop" | "head_office" | "mess" | "other";
export type AuditAction = "CREATED" | "MODIFIED" | "DELETED" | "SYNCED";
export type AuthMethod = "microsoft" | "password" | "phone_otp";
export type PersonType = "employee" | "third_party" | "other";
export type EmploymentType =
  | "permanent"
  | "contractual_with_email"
  | "contractual_no_email"
  | "third_party_vendor";

export type Role = {
  id: string;
  name: string;
  is_system_role: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type Permission = {
  id: string;
  key: string;
  module: string | null;
  // Short, human-readable name (e.g. "Audit Log", "Manage Tickets") — what every admin screen
  // should display. `description` is the longer explanatory line underneath; `key` is internal
  // plumbing (route-permissions.ts, requirePermission() calls, has_permission() checks) and
  // should never be shown as a label.
  label: string;
  description: string | null;
  created_at: string;
};

// Direct role -> permission grant (0019_direct_role_permissions.sql). Replaced the old
// permission_groups/permission_group_permissions/role_permission_groups chain — confirmed no
// group there ever actually bundled more than one permission, so the indirection was pure
// naming confusion with no real grouping behind it.
export type RolePermission = {
  role_id: string;
  permission_id: string;
  granted_by: string | null;
  granted_at: string;
};

export type Company = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// Universal identity — anyone the org has a relationship with, whether or not they ever log in.
// Decoupled from auth.users; see user_accounts for the (optional) login layer.
export type Person = {
  id: string;
  full_name: string;
  personal_email: string | null;
  phone: string | null;
  cnic: string | null;
  date_of_birth: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  person_type: PersonType;
  employee_code: string | null;
  designation: string | null;
  company_id: string | null;
  site_id: string | null;
  employment_type: EmploymentType | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  date_of_joining: string | null;
  status: UserStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// The login layer. Only exists for people who need to log in — links persons.id to
// auth.users.id. A 3rd-party vendor worker can exist as a Person with zero UserAccount rows.
export type UserAccount = {
  id: string;
  person_id: string;
  auth_user_id: string;
  email: string;
  auth_method: AuthMethod;
  is_external: boolean;
  sponsoring_company_id: string | null;
  access_expires_at: string | null;
  status: UserStatus;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

// Multi-role, optionally company/site-scoped role assignment. Replaces the old single unscoped
// profiles.role_id column — a person can hold more than one row here.
export type UserRoleAssignment = {
  id: string;
  person_id: string;
  role_id: string;
  company_id: string | null;
  site_id: string | null;
  granted_by: string | null;
  granted_at: string;
  expires_at: string | null;
};

export type InvitedUser = {
  email: string;
  display_name: string | null;
  role_id: string;
  department: string | null;
  site: string | null;
  status: UserStatus;
  notes: string | null;
  employee_code: string | null;
  designation: string | null;
  date_of_joining: string | null;
  invited_by: string | null;
  invited_at: string;
};

export type OrgUnit = {
  id: string;
  name: string;
  short_code: string | null;
  type: OrgUnitType;
  description: string | null;
  is_active: boolean;
  site_type: OrgUnitSiteType | null;
  created_at: string;
  updated_at: string;
};

// Many-to-many: an org_unit (site or department) can serve more than one company, and a
// company can have many org_units. See 0007_org_hierarchy.sql for why this isn't a single
// company_id column on OrgUnit.
export type OrgUnitCompany = {
  org_unit_id: string;
  company_id: string;
};

export type AuditLog = {
  id: string;
  actor_id: string | null;
  actor_label: string;
  module: string;
  action: AuditAction;
  details: string;
  created_at: string;
};

// HR module (hr.* schema) — mirrors supabase/migrations/0012_hr_module.sql. See
// 06-hr-module-design.md for the design this was built against.
export type TicketStatus = "Open" | "In Progress" | "Resolved" | "Closed";
export type AnonymousConversationStatus = "Open" | "Closed";
export type AnonymousMessageSenderType = "submitter" | "hr";

export type AnonymousConversation = {
  id: string;
  department_org_unit_id: string;
  status: AnonymousConversationStatus;
  created_at: string;
  updated_at: string;
};

export type AnonymousMessage = {
  id: string;
  conversation_id: string;
  sender_type: AnonymousMessageSenderType;
  sender_person_id: string | null;
  body: string;
  created_at: string;
};

export type HrbpDepartment = {
  person_id: string;
  department_org_unit_id: string;
};

export type TicketCategory = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TicketCategoryAssignee = {
  category_id: string;
  person_id: string;
};

export type Ticket = {
  id: string;
  person_id: string;
  category_id: string | null;
  subject: string;
  body: string;
  status: TicketStatus;
  assigned_to_person_id: string | null;
  company_id: string | null;
  site_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type TicketMessage = {
  id: string;
  ticket_id: string;
  sender_person_id: string;
  body: string;
  created_at: string;
};

// IT module (it.* schema), Service Management track — mirrors
// supabase/it-migrations/javaria/javaria_it_0001_tickets.sql. See
// 08-it-service-management-plan.md. Prefixed "It" so nothing collides with the HR types above.
export type ItTicketStatus = "Open" | "Assigned" | "In Progress" | "On Hold" | "Resolved" | "Closed";
export type ItTicketPriority = "Critical" | "High" | "Medium" | "Low";
export type ItContactMethod = "Portal" | "Email" | "Phone" | "Teams";
// Capitalised in the live check constraint (talha_it_0000 baseline).
export type ItRequestTypeAppliesTo = "Ticket" | "Onboarding" | "Offboarding" | "Replacement";
export type ItTicketUpdateType =
  | "comment"
  | "work_note"
  | "status_change"
  | "assignment"
  | "priority_change"
  | "escalation"
  | "system";
export type ItTicketTaskStatus = "Pending" | "In Progress" | "Completed" | "Cancelled";

export type ItRequestType = {
  id: string;
  name: string;
  applies_to: ItRequestTypeAppliesTo;
  description: string | null;
  is_active: boolean;
  handled_at: ItHandledAt; // javaria_it_0005
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

// Phase 6.1 site routing — mirrors javaria_it_0005_site_routing.sql.
export type ItHandledAt = "site" | "hq";
export type ItSiteRole = "manager" | "member";

export type ItSettings = {
  id: boolean;
  hq_site_id: string | null;
  updated_at: string;
  updated_by: string | null;
};

export type ItSiteItStaff = {
  site_id: string;
  person_id: string;
  role: ItSiteRole;
  created_at: string;
  created_by: string | null;
};

// Phase 6.2 / 6.3 — javaria_it_0006_owners_and_assignees.sql
export type ItCategoryOwner = {
  category_id: string;
  site_id: string;
  person_id: string;
  is_primary: boolean;
  created_at: string;
  created_by: string | null;
};

export type ItAssigneeRole = "primary" | "helper";

export type ItTicketAssignee = {
  ticket_id: string;
  person_id: string;
  role: ItAssigneeRole;
  assigned_by: string | null;
  assigned_at: string;
};

export type ItTicketTaskAssignee = {
  task_id: string;
  person_id: string;
  assigned_at: string;
};

// Procurement Phase 1 — javaria_it_0009_procurement_masters.sql
export type ItVendor = {
  id: string;
  vendor_name: string;
  contact_person: string | null;
  contact_no: string | null;
  email: string | null;
  address: string | null;
  tax_number: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type ItProduct = {
  id: string;
  product_name: string;
  category: string | null;
  unit: string;
  purchase_price: number | null;
  current_price: number | null;
  description: string | null;
  asset_type_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type ItProcurementSettings = {
  id: boolean;
  finance_sla_days: number;
  reminder_interval_days: number;
  invoice_tolerance_pct: number;
  consumable_path_enabled: boolean;
  updated_at: string;
  updated_by: string | null;
};

// Employee picker / own details — javaria_it_0018_employee_lookup.sql
export type EmployeeLookup = {
  person_id: string;
  full_name: string;
  employee_code: string | null;
  designation: string | null;
  company_name: string | null;
  site_id: string | null;
  site_name: string | null;
  employment_type: string | null;
  employee_category: ItEmployeeCategory | null;
  date_of_joining: string | null;
  contract_end_date: string | null;
  status: string;
};

// Procurement Phase 2 — javaria_it_0010_demands.sql
export type ItDemandStatus =
  | "Open"
  | "Categorized"
  | "Pending Approval"
  | "Approved"
  | "Partially Approved"
  | "Rejected"
  | "Assigned to Vendor"
  | "Partially Received"
  | "Received"
  | "Invoicing"
  | "Stock Updated"
  | "Closed"
  | "Cancelled";

export type ItDemandCategory = "Consumable" | "Open" | "Repair" | "Maintenance" | "Fix";

export type ItDemand = {
  id: string;
  demand_number: string;
  product_id: string;
  requested_by_person_id: string;
  department_id: string;
  site_id: string;
  company_id: string | null;
  quantity: number;
  justification: string;
  estimated_unit_price: number | null;
  status: ItDemandStatus;
  demand_category: ItDemandCategory | null;
  categorized_at: string | null;
  categorized_by: string | null;
  vendor_id: string | null;
  approved_quantity: number | null;
  stock_note: string | null;
  stock_updated_at: string | null;
  stock_updated_by: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  // javaria_it_0012_receiving_documents.sql
  expected_delivery_date: string | null;
  vendor_assigned_at: string | null;
  vendor_assigned_by: string | null;
  follow_up_on: string | null;
  // Total ACCEPTED quantity across deliveries (javaria_it_0013).
  received_quantity: number;
  // javaria_it_0013_procurement_improvements.sql
  agreed_unit_price: number | null;
  approval_follow_up_on: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type ItDemandUpdate = {
  id: string;
  demand_id: string;
  author_person_id: string | null;
  update_type:
    | "comment"
    | "work_note"
    | "created"
    | "edit"
    | "category_change"
    | "status_change"
    | "system";
  body: string;
  is_internal: boolean;
  created_at: string;
};

// Procurement Phase 3 — javaria_it_0011_demand_approvals.sql
export type ItDemandDecision = "Approved" | "Partially Approved" | "Rejected";

export type ItDepartmentApprover = {
  department_id: string;
  person_id: string;
  can_approve_demands: boolean;
  can_approve_invoices: boolean;
  created_at: string;
  created_by: string | null;
};

export type ItDemandApproval = {
  id: string;
  demand_id: string;
  approver_person_id: string;
  decision: ItDemandDecision;
  approved_quantity: number;
  comments: string | null;
  decided_at: string;
};

// Procurement Phase 4 — javaria_it_0012_receiving_documents.sql
export type ItReceivingCondition = "Good" | "Partially Damaged" | "Damaged";

export type ItReceivingRecord = {
  id: string;
  receiving_number: string;
  demand_id: string;
  vendor_id: string | null;
  received_by_person_id: string | null;
  received_date: string;
  // Delivered; accepted_quantity excludes damaged / rejected items (javaria_it_0013).
  received_quantity: number;
  accepted_quantity: number;
  condition: ItReceivingCondition;
  status: "Full" | "Partial" | "Not Received";
  delivery_challan_no: string | null;
  gate_pass_no: string | null;
  remarks: string | null;
  site_id: string | null;
  company_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type ItDocumentType =
  | "Delivery Challan"
  | "Gate Pass"
  | "Quotation"
  | "Invoice"
  | "Approval"
  | "Payment Proof"
  | "Photo"
  | "Other";

export type ItDocument = {
  id: string;
  entity_type: "demand" | "receiving" | "invoice" | "payment" | "asset";
  entity_id: string;
  demand_id: string | null;
  doc_type: ItDocumentType;
  storage_path: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
};

// Procurement Phase 5 — javaria_it_0014_invoices.sql
export type ItInvoiceStatus =
  | "Logged"
  | "Verified"
  | "Flagged"
  | "Pending Approval"
  | "Approved"
  | "Revise"
  | "Sent to Finance"
  | "Confirmed"
  | "Paid";

export type ItInvoice = {
  id: string;
  receiving_id: string;
  demand_id: string;
  vendor_id: string | null;
  site_id: string | null;
  company_id: string | null;
  invoice_number: string;
  invoice_date: string;
  invoice_quantity: number;
  invoice_amount: number;
  tax_amount: number;
  cost_center: string | null; // javaria_it_0017
  notes: string | null;
  status: ItInvoiceStatus;
  expected_amount: number | null;
  quantity_mismatch: boolean;
  amount_mismatch: boolean;
  verification_notes: string | null;
  flag_cleared_by: string | null;
  flag_cleared_at: string | null;
  flag_clear_note: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  approval_comments: string | null;
  revision_reason: string | null;
  sent_to_finance_at: string | null;
  sent_to_finance_by: string | null;
  // javaria_it_0015_payments.sql
  finance_due_on: string | null;
  finance_reminded_on: string | null;
  finance_confirmed_at: string | null;
  finance_confirmed_by: string | null;
  paid_amount: number;
  paid_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

// Procurement Phase 6 — javaria_it_0015_payments.sql
export type ItPaymentMethod = "Bank Transfer" | "Cheque" | "Online" | "Cash" | "Other";

export type ItPayment = {
  id: string;
  payment_number: string;
  invoice_id: string;
  demand_id: string;
  vendor_id: string | null;
  site_id: string | null;
  company_id: string | null;
  payment_reference: string;
  payment_date: string;
  paid_amount: number;
  payment_method: ItPaymentMethod;
  status: "Recorded" | "Reference Sent to Vendor";
  remarks: string | null;
  vendor_notified_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

// Phase 6.4 — javaria_it_0007_closure_audit.sql
export type ItTicketClosureAudit = {
  id: string;
  ticket_id: string;
  ticket_number: string;
  handling_site_id: string | null;
  closed_by: string | null;
  closed_at: string;
  sla_met: boolean | null;
  snapshot: Record<string, unknown>;
};

// IT module (M2) — inventory settings (supabase/it-migrations/talha/talha_it_0002_inventory_settings.sql).
export type AssetClassification = "Fixed" | "Consumable";
export type AssetValueTypeName = "New" | "Old";
export type DepreciationMethod = "Straight Line" | "Reducing Balance";

export type AssetType = {
  id: string;
  name: string;
  classification: AssetClassification;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type ItTicketCategory = {
  id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  handled_at: ItHandledAt; // javaria_it_0005
  created_at: string;
  updated_at: string;
};

export type ItSlaPolicy = {
  priority: ItTicketPriority;
  response_hours: number;
  resolution_hours: number;
  updated_at: string;
};

export type ItTicket = {
  id: string;
  ticket_number: string;
  requester_person_id: string;
  requested_for_person_id: string | null;
  request_type_id: string;
  category_id: string | null;
  subcategory_id: string | null;
  priority: ItTicketPriority;
  subject: string;
  description: string;
  status: ItTicketStatus;
  assigned_to_person_id: string | null;
  linked_asset_id: string | null;
  asset_system_name: string | null;
  access_required: string | null;
  manager_approval_required: boolean;
  preferred_contact_method: ItContactMethod;
  remarks: string | null;
  company_id: string | null;
  site_id: string | null;
  department_id: string | null;
  response_due_at: string | null;
  resolution_due_at: string | null;
  first_responded_at: string | null;
  resolution_notes: string | null;
  root_cause: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  closure_remarks: string | null;
  is_escalated: boolean;
  escalated_at: string | null;
  escalated_by: string | null;
  escalation_reason: string | null;
  reopen_count: number;
  requester_confirmed_at: string | null;
  satisfaction_rating: number | null;
  satisfaction_comment: string | null;
  sla_breach_notified_at: string | null; // javaria_it_0003
  handling_site_id: string | null; // javaria_it_0005: which site's IT team handles it
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type AssetValueType = {
  id: string;
  name: AssetValueTypeName;
  depreciation_percentage: number;
  depreciation_method: DepreciationMethod;
  useful_life_years: number | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type ItTicketUpdate = {
  id: string;
  ticket_id: string;
  author_person_id: string | null;
  update_type: ItTicketUpdateType;
  body: string;
  is_internal: boolean;
  created_at: string;
};

export type ItTicketTask = {
  id: string;
  ticket_id: string;
  assigned_to_person_id: string | null;
  task_type: string;
  description: string | null;
  status: ItTicketTaskStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

// Onboarding / Offboarding — mirrors javaria_it_0002_onboarding_offboarding.sql.
export type ItLifecycleKind = "Onboarding" | "Offboarding" | "Replacement";
export type ItLifecycleStatus =
  | "Open"
  | "Under Review"
  | "In Progress"
  | "Awaiting Confirmation"
  | "Pending Final Review"
  | "Completed"
  | "Closed"
  | "Cancelled";
export type ItChecklistStatus = "Pending" | "In Progress" | "Completed" | "Not Applicable";
export type ItChecklistTaskType =
  | "email_account"
  | "access_provisioning"
  | "software_installation"
  | "asset_allocation"
  | "portal_account"
  | "email_backup_closure"
  | "access_revocation"
  | "hardware_recovery"
  | "asset_return"
  | "license_deactivation"
  | "other";
export type ItEmployeeCategory = "Permanent" | "Contractual";
export type ItOnboardingUpdateType =
  | "comment"
  | "work_note"
  | "status_change"
  | "task_update"
  | "sign_off"
  | "system";

export type ItLifecycleRequest = {
  id: string;
  request_number: string;
  request_type_id: string;
  kind: ItLifecycleKind;
  person_id: string | null;
  employee_name: string;
  employee_code: string | null;
  designation: string | null;
  grade: string | null;
  employee_category: ItEmployeeCategory | null;
  company_id: string | null;
  site_id: string | null;
  department_id: string | null;
  reporting_manager_name: string | null;
  personal_email: string | null;
  joining_date: string | null;
  last_working_date: string | null;
  laptop_required: boolean;
  email_required: boolean;
  access_required: string | null;
  software_required: string | null;
  known_assets_accesses: string | null;
  priority: ItTicketPriority;
  remarks: string | null;
  routing_team: "IT HQ Team" | "IT Plant Site Team";
  it_executive_person_id: string | null;
  status: ItLifecycleStatus;
  due_date: string | null;
  requested_by: string | null;
  email_confirmed: boolean | null;
  access_confirmed: boolean | null;
  software_confirmed: boolean | null;
  asset_confirmed: boolean | null;
  confirmation_notes: string | null;
  employee_confirmed_at: string | null;
  executive_signed_by: string | null;
  executive_signed_at: string | null;
  hod_signed_by: string | null;
  hod_signed_at: string | null;
  completed_at: string | null;
  closed_at: string | null;
  cancelled_reason: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type ItChecklistItem = {
  id: string;
  request_id: string;
  task_type: ItChecklistTaskType;
  task_name: string;
  sort_order: number;
  assigned_to_person_id: string | null;
  status: ItChecklistStatus;
  due_date: string | null;
  details: Record<string, string>;
  notes: string | null;
  assignment_id: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ItOnboardingUpdate = {
  id: string;
  request_id: string;
  author_person_id: string | null;
  update_type: ItOnboardingUpdateType;
  body: string;
  is_internal: boolean;
  created_at: string;
};

// Notifications — mirrors javaria_it_0003_notifications.sql.
export type ItNotificationEmailStatus = "pending" | "sent" | "failed" | "skipped";

export type ItNotification = {
  id: string;
  recipient_person_id: string | null;
  recipient_email: string | null;
  event: string;
  title: string;
  body: string | null;
  link: string | null;
  ticket_id: string | null;
  request_id: string | null;
  demand_id: string | null;
  invoice_id: string | null;
  read_at: string | null;
  email_status: ItNotificationEmailStatus;
  email_error: string | null;
  emailed_at: string | null;
  created_at: string;
};

export type ItTicketAttachment = {
  id: string;
  ticket_id: string;
  storage_path: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
};

// IT module (M2) — asset register (supabase/it-migrations/talha/talha_it_0003_assets.sql).
export type Asset = {
  id: string;
  asset_tag: string;
  serial_number: string;
  asset_name: string;
  asset_type_id: string;
  manufacturer: string | null;
  model_number: string | null;
  company_id: string;
  site_id: string | null;
  purchase_date: string | null;
  vendor_id: string | null;
  receiving_id: string | null;
  status: "Unassigned" | "In Use" | "In Repair" | "Retired" | "Disposed" | "Lost";
  condition: string | null;
  warranty_expiry: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;
};

// it.asset_assignments (talha_it_0004). Written only through it.assign_asset / it.return_asset /
// it.acknowledge_assignment — never inserted or updated directly.
export type AssetAssignment = {
  id: string;
  asset_id: string;
  person_id: string;
  company_id: string;
  site_id: string | null;
  assigned_by_person_id: string;
  returned_to_person_id: string | null;
  assigned_date: string;
  return_date: string | null;
  assigned_condition: string | null;
  returned_condition: string | null;
  status: "Active" | "Returned";
  remarks: string | null;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

// it.asset_maintenance (talha_it_0005). Read-only for the app: written only through
// it.open_maintenance / it.close_maintenance (Phase 4).
export type AssetMaintenance = {
  id: string;
  asset_id: string;
  company_id: string;
  site_id: string | null;
  vendor_id: string | null;
  issue_type: string;
  description: string | null;
  service_date: string;
  cost: number;
  status: "Open" | "Completed";
  resolution: string | null;
  returned_date: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

// it.asset_values (talha_it_0006).
export type AssetValue = {
  id: string;
  asset_id: string;
  value_type_id: string;
  purchase_value: number;
  current_value: number;
  accumulated_depreciation: number;
  salvage_value: number;
  valuation_date: string;
  remarks: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type Database = {
  public: {
    Tables: {
      roles: {
        Row: Role;
        Insert: Partial<Role> & Pick<Role, "name">;
        Update: Partial<Role>;
        Relationships: [];
      };
      permissions: {
        Row: Permission;
        Insert: Partial<Permission> & Pick<Permission, "key" | "label">;
        Update: Partial<Permission>;
        Relationships: [];
      };
      role_permissions: {
        Row: RolePermission;
        Insert: Pick<RolePermission, "role_id" | "permission_id"> &
          Partial<Pick<RolePermission, "granted_by" | "granted_at">>;
        Update: Partial<RolePermission>;
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "role_permissions_permission_id_fkey";
            columns: ["permission_id"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "role_permissions_granted_by_fkey";
            columns: ["granted_by"];
            isOneToOne: false;
            referencedRelation: "persons";
            referencedColumns: ["id"];
          },
        ];
      };
      companies: {
        Row: Company;
        Insert: Partial<Company> & Pick<Company, "code" | "name">;
        Update: Partial<Company>;
        Relationships: [];
      };
      persons: {
        Row: Person;
        Insert: Partial<Person> & Pick<Person, "full_name">;
        Update: Partial<Person>;
        Relationships: [
          {
            foreignKeyName: "persons_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "persons_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "org_units";
            referencedColumns: ["id"];
          },
        ];
      };
      user_accounts: {
        Row: UserAccount;
        Insert: Partial<UserAccount> & Pick<UserAccount, "person_id" | "auth_user_id" | "email">;
        Update: Partial<UserAccount>;
        Relationships: [
          {
            foreignKeyName: "user_accounts_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: true;
            referencedRelation: "persons";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: UserRoleAssignment;
        Insert: Partial<UserRoleAssignment> & Pick<UserRoleAssignment, "person_id" | "role_id">;
        Update: Partial<UserRoleAssignment>;
        Relationships: [
          {
            foreignKeyName: "user_roles_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "persons";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_roles_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
        ];
      };
      invited_users: {
        Row: InvitedUser;
        Insert: Partial<InvitedUser> & Pick<InvitedUser, "email" | "role_id">;
        Update: Partial<InvitedUser>;
        Relationships: [
          {
            foreignKeyName: "invited_users_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invited_users_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "persons";
            referencedColumns: ["id"];
          },
        ];
      };
      org_units: {
        Row: OrgUnit;
        Insert: Partial<OrgUnit> & Pick<OrgUnit, "name" | "type">;
        Update: Partial<OrgUnit>;
        Relationships: [];
      };
      org_unit_companies: {
        Row: OrgUnitCompany;
        Insert: OrgUnitCompany;
        Update: Partial<OrgUnitCompany>;
        Relationships: [
          {
            foreignKeyName: "org_unit_companies_org_unit_id_fkey";
            columns: ["org_unit_id"];
            isOneToOne: false;
            referencedRelation: "org_units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_unit_companies_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: AuditLog;
        Insert: Partial<AuditLog> &
          Pick<AuditLog, "actor_label" | "module" | "action" | "details">;
        Update: Partial<AuditLog>;
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "persons";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      current_person_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      has_permission: {
        Args: { p_permission_key: string };
        Returns: boolean;
      };
      update_own_biodata: {
        Args: {
          p_display_name: string | null;
          p_cnic: string | null;
          p_date_of_birth: string | null;
          p_address: string | null;
          p_emergency_contact_name: string | null;
          p_emergency_contact_phone: string | null;
        };
        Returns: undefined;
      };
    };
  };
  hr: {
    Tables: {
      anonymous_conversations: {
        Row: AnonymousConversation;
        Insert: Partial<AnonymousConversation> &
          Pick<AnonymousConversation, "department_org_unit_id">;
        Update: Partial<AnonymousConversation>;
        // department_org_unit_id -> public.org_units(id) is a real FK, but supabase-js can only
        // type an embedded `.select("org_units(...)")` for a relationship whose referencedRelation
        // lives in this same schema's Tables map — cross-schema embeds aren't resolvable here, so
        // callers fetch org_units separately instead of embedding it.
        Relationships: [];
      };
      anonymous_messages: {
        Row: AnonymousMessage;
        Insert: Partial<AnonymousMessage> &
          Pick<AnonymousMessage, "conversation_id" | "sender_type" | "body">;
        Update: Partial<AnonymousMessage>;
        Relationships: [
          {
            foreignKeyName: "anonymous_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "anonymous_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      hrbp_departments: {
        Row: HrbpDepartment;
        Insert: HrbpDepartment;
        Update: Partial<HrbpDepartment>;
        Relationships: [];
      };
      ticket_categories: {
        Row: TicketCategory;
        Insert: Partial<TicketCategory> & Pick<TicketCategory, "name">;
        Update: Partial<TicketCategory>;
        Relationships: [];
      };
      ticket_category_assignees: {
        Row: TicketCategoryAssignee;
        Insert: TicketCategoryAssignee;
        Update: Partial<TicketCategoryAssignee>;
        Relationships: [
          {
            foreignKeyName: "ticket_category_assignees_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "ticket_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      tickets: {
        Row: Ticket;
        Insert: Partial<Ticket> & Pick<Ticket, "person_id" | "subject" | "body">;
        Update: Partial<Ticket>;
        Relationships: [
          {
            foreignKeyName: "tickets_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "ticket_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      ticket_messages: {
        Row: TicketMessage;
        Insert: Partial<TicketMessage> & Pick<TicketMessage, "ticket_id" | "sender_person_id" | "body">;
        Update: Partial<TicketMessage>;
        Relationships: [
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      reply_to_anonymous_conversation: {
        Args: { p_conversation_id: string; p_body: string };
        Returns: undefined;
      };
    };
  };
  // Cross-schema FKs to public.persons / org_units aren't listed in Relationships (same reason
  // as the hr block) — names are resolved through it.person_names() / it.list_org_units()
  // instead. Combines both IT tracks: Service Management (Javaria) and Inventory (Talha).
  it: {
    Tables: {
      request_types: {
        Row: ItRequestType;
        Insert: Partial<ItRequestType> & Pick<ItRequestType, "name" | "applies_to">;
        Update: Partial<ItRequestType>;
        Relationships: [];
      };
      ticket_categories: {
        Row: ItTicketCategory;
        Insert: Partial<ItTicketCategory> & Pick<ItTicketCategory, "name">;
        Update: Partial<ItTicketCategory>;
        Relationships: [
          {
            foreignKeyName: "ticket_categories_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "ticket_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      settings: {
        Row: ItSettings;
        Insert: Partial<ItSettings>;
        Update: Partial<ItSettings>;
        Relationships: [];
      };
      site_it_staff: {
        Row: ItSiteItStaff;
        Insert: Partial<ItSiteItStaff> & Pick<ItSiteItStaff, "site_id" | "person_id">;
        Update: Partial<ItSiteItStaff>;
        Relationships: [];
      };
      // javaria_it_0009_procurement_masters.sql
      vendors: {
        Row: ItVendor;
        Insert: Partial<ItVendor> & Pick<ItVendor, "vendor_name">;
        Update: Partial<ItVendor>;
        Relationships: [];
      };
      products: {
        Row: ItProduct;
        Insert: Partial<ItProduct> & Pick<ItProduct, "product_name">;
        Update: Partial<ItProduct>;
        Relationships: [];
      };
      procurement_settings: {
        Row: ItProcurementSettings;
        Insert: Partial<ItProcurementSettings>;
        Update: Partial<ItProcurementSettings>;
        Relationships: [];
      };
      // javaria_it_0010_demands.sql
      demands: {
        Row: ItDemand;
        Insert: Partial<ItDemand> &
          Pick<ItDemand, "product_id" | "department_id" | "quantity" | "justification">;
        Update: Partial<ItDemand>;
        Relationships: [];
      };
      demand_updates: {
        Row: ItDemandUpdate;
        Insert: Partial<ItDemandUpdate> & Pick<ItDemandUpdate, "demand_id" | "body">;
        Update: Partial<ItDemandUpdate>;
        Relationships: [];
      };
      // javaria_it_0011_demand_approvals.sql
      department_approvers: {
        Row: ItDepartmentApprover;
        Insert: Partial<ItDepartmentApprover> & Pick<ItDepartmentApprover, "department_id" | "person_id">;
        Update: Partial<ItDepartmentApprover>;
        Relationships: [];
      };
      demand_approvals: {
        Row: ItDemandApproval;
        // Written only by it.decide_demand(); no direct grants.
        Insert: Partial<ItDemandApproval>;
        Update: Partial<ItDemandApproval>;
        Relationships: [];
      };
      // javaria_it_0012_receiving_documents.sql — written only through functions.
      receiving_records: {
        Row: ItReceivingRecord;
        Insert: Partial<ItReceivingRecord>;
        Update: Partial<ItReceivingRecord>;
        Relationships: [];
      };
      documents: {
        Row: ItDocument;
        Insert: Partial<ItDocument>;
        Update: Partial<ItDocument>;
        Relationships: [];
      };
      // javaria_it_0014_invoices.sql — written only through functions.
      invoices: {
        Row: ItInvoice;
        Insert: Partial<ItInvoice>;
        Update: Partial<ItInvoice>;
        Relationships: [];
      };
      // javaria_it_0015_payments.sql — written only through functions.
      payments: {
        Row: ItPayment;
        Insert: Partial<ItPayment>;
        Update: Partial<ItPayment>;
        Relationships: [];
      };
      // javaria_it_0008_it_roles.sql — roles tagged as IT department roles.
      it_roles: {
        Row: { role_id: string; created_at: string; created_by: string | null };
        Insert: { role_id: string; created_by?: string | null };
        Update: Partial<{ role_id: string; created_by: string | null }>;
        Relationships: [];
      };
      category_owners: {
        Row: ItCategoryOwner;
        Insert: Partial<ItCategoryOwner> &
          Pick<ItCategoryOwner, "category_id" | "site_id" | "person_id">;
        Update: Partial<ItCategoryOwner>;
        Relationships: [];
      };
      ticket_assignees: {
        Row: ItTicketAssignee;
        Insert: Partial<ItTicketAssignee> & Pick<ItTicketAssignee, "ticket_id" | "person_id">;
        Update: Partial<ItTicketAssignee>;
        Relationships: [];
      };
      ticket_task_assignees: {
        Row: ItTicketTaskAssignee;
        Insert: Partial<ItTicketTaskAssignee> & Pick<ItTicketTaskAssignee, "task_id" | "person_id">;
        Update: Partial<ItTicketTaskAssignee>;
        Relationships: [];
      };
      ticket_closure_audit: {
        Row: ItTicketClosureAudit;
        Insert: Partial<ItTicketClosureAudit>;
        Update: Partial<ItTicketClosureAudit>;
        Relationships: [];
      };
      sla_policies: {
        Row: ItSlaPolicy;
        Insert: Partial<ItSlaPolicy> &
          Pick<ItSlaPolicy, "priority" | "response_hours" | "resolution_hours">;
        Update: Partial<ItSlaPolicy>;
        Relationships: [];
      };
      tickets: {
        Row: ItTicket;
        Insert: Partial<ItTicket> &
          Pick<ItTicket, "requester_person_id" | "request_type_id" | "subject" | "description">;
        Update: Partial<ItTicket>;
        Relationships: [
          {
            foreignKeyName: "tickets_request_type_id_fkey";
            columns: ["request_type_id"];
            isOneToOne: false;
            referencedRelation: "request_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "ticket_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_subcategory_id_fkey";
            columns: ["subcategory_id"];
            isOneToOne: false;
            referencedRelation: "ticket_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      ticket_updates: {
        Row: ItTicketUpdate;
        Insert: Partial<ItTicketUpdate> & Pick<ItTicketUpdate, "ticket_id" | "body">;
        Update: Partial<ItTicketUpdate>;
        Relationships: [
          {
            foreignKeyName: "ticket_updates_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      ticket_tasks: {
        Row: ItTicketTask;
        Insert: Partial<ItTicketTask> & Pick<ItTicketTask, "ticket_id" | "task_type">;
        Update: Partial<ItTicketTask>;
        Relationships: [
          {
            foreignKeyName: "ticket_tasks_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      ticket_attachments: {
        Row: ItTicketAttachment;
        Insert: Partial<ItTicketAttachment> &
          Pick<ItTicketAttachment, "ticket_id" | "storage_path" | "file_name">;
        Update: Partial<ItTicketAttachment>;
        Relationships: [
          {
            foreignKeyName: "ticket_attachments_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      onboarding_offboarding: {
        Row: ItLifecycleRequest;
        Insert: Partial<ItLifecycleRequest> &
          Pick<ItLifecycleRequest, "request_type_id" | "employee_name">;
        Update: Partial<ItLifecycleRequest>;
        Relationships: [
          {
            foreignKeyName: "onboarding_offboarding_request_type_id_fkey";
            columns: ["request_type_id"];
            isOneToOne: false;
            referencedRelation: "request_types";
            referencedColumns: ["id"];
          },
        ];
      };
      checklist_items: {
        Row: ItChecklistItem;
        Insert: Partial<ItChecklistItem> &
          Pick<ItChecklistItem, "request_id" | "task_type" | "task_name">;
        Update: Partial<ItChecklistItem>;
        Relationships: [
          {
            foreignKeyName: "checklist_items_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "onboarding_offboarding";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: ItNotification;
        Insert: Partial<ItNotification> & Pick<ItNotification, "event" | "title">;
        Update: Partial<ItNotification>;
        Relationships: [];
      };
      onboarding_updates: {
        Row: ItOnboardingUpdate;
        Insert: Partial<ItOnboardingUpdate> & Pick<ItOnboardingUpdate, "request_id" | "body">;
        Update: Partial<ItOnboardingUpdate>;
        Relationships: [
          {
            foreignKeyName: "onboarding_updates_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "onboarding_offboarding";
            referencedColumns: ["id"];
          },
        ];
      };
      asset_types: {
        Row: AssetType;
        Insert: Partial<AssetType> & Pick<AssetType, "name" | "classification">;
        Update: Partial<AssetType>;
        Relationships: [];
      };
      asset_value_types: {
        Row: AssetValueType;
        Insert: Partial<AssetValueType> &
          Pick<AssetValueType, "name" | "depreciation_percentage">;
        Update: Partial<AssetValueType>;
        Relationships: [];
      };
      assets: {
        Row: Asset;
        Insert: Partial<Asset> &
          Pick<Asset, "asset_tag" | "serial_number" | "asset_name" | "asset_type_id" | "company_id">;
        Update: Partial<Asset>;
        Relationships: [
          {
            foreignKeyName: "assets_asset_type_id_fkey";
            columns: ["asset_type_id"];
            isOneToOne: false;
            referencedRelation: "asset_types";
            referencedColumns: ["id"];
          },
        ];
      };
      asset_assignments: {
        Row: AssetAssignment;
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "asset_assignments_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "assets";
            referencedColumns: ["id"];
          },
        ];
      };
      asset_maintenance: {
        Row: AssetMaintenance;
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "asset_maintenance_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "assets";
            referencedColumns: ["id"];
          },
        ];
      };
      asset_values: {
        Row: AssetValue;
        Insert: Partial<AssetValue> &
          Pick<AssetValue, "asset_id" | "value_type_id" | "purchase_value" | "current_value">;
        Update: Partial<AssetValue>;
        Relationships: [
          {
            foreignKeyName: "asset_values_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "assets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "asset_values_value_type_id_fkey";
            columns: ["value_type_id"];
            isOneToOne: false;
            referencedRelation: "asset_value_types";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      confirm_onboarding: {
        Args: {
          p_request_id: string;
          p_email_ok: boolean;
          p_access_ok: boolean;
          p_software_ok: boolean;
          p_asset_ok: boolean;
          p_notes: string | null;
        };
        Returns: string;
      };
      sign_offboarding: {
        Args: { p_request_id: string; p_role: "executive" | "hod" };
        Returns: undefined;
      };
      link_onboarding_person: {
        Args: { p_request_id: string; p_person_id: string };
        Returns: undefined;
      };
      search_employees: {
        Args: { p_search: string };
        Returns: {
          person_id: string;
          full_name: string;
          employee_code: string | null;
          designation: string | null;
          site_id: string | null;
          status: string;
        }[];
      };
      list_onboarding_staff: {
        Args: Record<string, never>;
        Returns: { person_id: string; full_name: string; designation: string | null }[];
      };
      routing_team_for_site: {
        Args: { p_site_id: string | null };
        Returns: string;
      };
      next_number: {
        Args: { p_prefix: string; p_width?: number };
        Returns: string;
      };
      confirm_ticket_resolution: {
        Args: { p_ticket_id: string; p_rating: number; p_comment: string | null };
        Returns: undefined;
      };
      reopen_ticket: {
        Args: { p_ticket_id: string; p_reason: string };
        Returns: undefined;
      };
      list_it_staff: {
        Args: Record<string, never>;
        Returns: { person_id: string; full_name: string; designation: string | null }[];
      };
      person_names: {
        Args: { p_person_ids: string[] };
        Returns: {
          person_id: string;
          full_name: string;
          designation: string | null;
          employee_code: string | null;
        }[];
      };
      list_org_units: {
        Args: Record<string, never>;
        Returns: { id: string; name: string; type: OrgUnitType }[];
      };
      // javaria_it_0018_employee_lookup.sql
      employee_lookup: {
        Args: { p_search?: string | null; p_person_id?: string | null };
        Returns: EmployeeLookup[];
      };
      // javaria_it_0010_demands.sql
      demand_person_names: {
        Args: { p_person_ids: string[] };
        Returns: { person_id: string; full_name: string }[];
      };
      can_process_demand: {
        Args: { p_site_id: string };
        Returns: boolean;
      };
      can_see_site_demands: {
        Args: { p_site_id: string };
        Returns: boolean;
      };
      can_read_procurement_masters: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      // javaria_it_0011_demand_approvals.sql
      is_demand_approver: {
        Args: { p_department_id: string };
        Returns: boolean;
      };
      my_approver_departments: {
        Args: Record<string, never>;
        Returns: string[];
      };
      list_department_approvers: {
        Args: Record<string, never>;
        Returns: {
          department_id: string;
          person_id: string;
          full_name: string;
          designation: string | null;
          can_approve_demands: boolean;
          can_approve_invoices: boolean;
          has_permission: boolean;
        }[];
      };
      search_approver_candidates: {
        Args: { p_search: string };
        Returns: {
          person_id: string;
          full_name: string;
          employee_code: string | null;
          designation: string | null;
        }[];
      };
      // javaria_it_0012_receiving_documents.sql
      receiving_has_gate_proof: {
        Args: { p_receiving_id: string };
        Returns: boolean;
      };
      assign_demand_vendor: {
        Args: {
          p_demand_id: string;
          p_vendor_id: string;
          p_expected_date: string | null;
          p_agreed_price: number | null;
          p_note: string | null;
        };
        Returns: undefined;
      };
      // javaria_it_0015_payments.sql
      is_finance: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      confirm_invoice_package: {
        Args: { p_invoice_id: string; p_note: string | null };
        Returns: undefined;
      };
      return_invoice_package: {
        Args: { p_invoice_id: string; p_reason: string };
        Returns: undefined;
      };
      record_payment: {
        Args: {
          p_invoice_id: string;
          p_reference: string;
          p_payment_date: string;
          p_amount: number;
          p_method: ItPaymentMethod;
          p_remarks: string | null;
          p_notify_vendor: boolean;
        };
        Returns: string;
      };
      send_payment_reference: {
        Args: { p_payment_id: string };
        Returns: undefined;
      };
      add_payment_document: {
        Args: {
          p_payment_id: string;
          p_storage_path: string;
          p_file_name: string;
          p_content_type: string | null;
          p_size_bytes: number;
        };
        Returns: string;
      };
      // javaria_it_0014_invoices.sql
      can_manage_invoices: {
        Args: { p_site_id: string };
        Returns: boolean;
      };
      is_invoice_approver: {
        Args: { p_department_id: string };
        Returns: boolean;
      };
      my_invoice_approver_departments: {
        Args: Record<string, never>;
        Returns: string[];
      };
      log_invoice: {
        Args: {
          p_receiving_id: string;
          p_invoice_number: string;
          p_invoice_date: string;
          p_quantity: number;
          p_amount: number;
          p_tax: number;
          p_cost_center: string | null;
          p_notes: string | null;
        };
        Returns: string;
      };
      update_invoice: {
        Args: {
          p_invoice_id: string;
          p_invoice_number: string;
          p_invoice_date: string;
          p_quantity: number;
          p_amount: number;
          p_tax: number;
          p_cost_center: string | null;
          p_notes: string | null;
        };
        Returns: undefined;
      };
      clear_invoice_flag: {
        Args: { p_invoice_id: string; p_note: string };
        Returns: undefined;
      };
      submit_invoice_for_approval: {
        Args: { p_invoice_id: string };
        Returns: undefined;
      };
      decide_invoice: {
        Args: { p_invoice_id: string; p_decision: "Approved" | "Revise"; p_comments: string | null };
        Returns: undefined;
      };
      send_invoice_to_finance: {
        Args: { p_invoice_id: string };
        Returns: undefined;
      };
      add_invoice_document: {
        Args: {
          p_invoice_id: string;
          p_doc_type: "Invoice" | "Approval" | "Other";
          p_storage_path: string;
          p_file_name: string;
          p_content_type: string | null;
          p_size_bytes: number;
        };
        Returns: string;
      };
      revise_rejected_demand: {
        Args: { p_demand_id: string; p_quantity: number; p_justification: string; p_note: string };
        Returns: undefined;
      };
      record_receiving: {
        Args: {
          p_demand_id: string;
          p_received_date: string;
          p_quantity: number;
          p_accepted_quantity: number | null;
          p_condition: ItReceivingCondition;
          p_challan_no: string | null;
          p_gate_pass_no: string | null;
          p_remarks: string | null;
        };
        Returns: string;
      };
      update_receiving_refs: {
        Args: { p_receiving_id: string; p_challan_no: string | null; p_gate_pass_no: string | null };
        Returns: undefined;
      };
      add_procurement_document: {
        Args: {
          p_demand_id: string;
          p_receiving_id: string | null;
          p_doc_type: ItDocumentType;
          p_storage_path: string;
          p_file_name: string;
          p_content_type: string | null;
          p_size_bytes: number;
        };
        Returns: string;
      };
      submit_demand_for_approval: {
        Args: { p_demand_id: string };
        Returns: undefined;
      };
      decide_demand: {
        Args: {
          p_demand_id: string;
          p_decision: ItDemandDecision;
          p_approved_quantity: number | null;
          p_comments: string | null;
        };
        Returns: undefined;
      };
      // javaria_it_0004_ticket_asset_link.sql
      // javaria_it_0005_site_routing.sql
      my_ticket_scope: {
        Args: Record<string, never>;
        Returns: {
          read_all: boolean;
          hq_executive: boolean;
          site_ids: string[];
          managed_site_ids: string[];
          hq_site_id: string | null;
        }[];
      };
      transfer_ticket_to_hq: {
        Args: { p_ticket_id: string; p_reason: string };
        Returns: undefined;
      };
      list_ticket_assignees: {
        Args: { p_ticket_id: string };
        Returns: {
          person_id: string;
          full_name: string;
          designation: string | null;
          site_role: ItSiteRole | null;
          is_category_owner: boolean; // javaria_it_0006
        }[];
      };
      // javaria_it_0008_it_roles.sql
      set_role_it_permission: {
        Args: { p_role_id: string; p_permission_id: string; p_granted: boolean };
        Returns: undefined;
      };
      create_it_role: {
        Args: { p_name: string; p_description: string | null };
        Returns: string;
      };
      set_it_role_tag: {
        Args: { p_role_id: string; p_is_it: boolean };
        Returns: undefined;
      };
      list_category_owners: {
        Args: Record<string, never>;
        Returns: {
          category_id: string;
          site_id: string;
          person_id: string;
          full_name: string;
          is_primary: boolean;
        }[];
      };
      list_site_it_staff: {
        Args: Record<string, never>;
        Returns: {
          site_id: string;
          person_id: string;
          full_name: string;
          designation: string | null;
          role: ItSiteRole;
        }[];
      };
      search_assets_for_ticket: {
        Args: { p_search: string };
        Returns: {
          asset_id: string;
          asset_tag: string;
          asset_name: string;
          serial_number: string;
          status: string;
          site_id: string | null;
        }[];
      };
      ticket_asset_labels: {
        Args: { p_asset_ids: string[] };
        Returns: {
          asset_id: string;
          asset_tag: string;
          asset_name: string;
          serial_number: string;
        }[];
      };
      search_my_assets_for_ticket: {
        Args: { p_search: string };
        Returns: {
          asset_id: string;
          asset_tag: string;
          asset_name: string;
          serial_number: string;
          status: string;
        }[];
      };
      search_unassigned_assets: {
        Args: { p_search: string };
        Returns: {
          asset_id: string;
          asset_tag: string;
          asset_name: string;
          serial_number: string;
        }[];
      };
      assign_asset: {
        Args: {
          p_asset_id: string;
          p_person_id: string;
          p_condition?: string | null;
          p_remarks?: string | null;
          p_assigned_date?: string;
        };
        Returns: string;
      };
      return_asset: {
        Args: {
          p_assignment_id: string;
          p_returned_condition?: string | null;
          p_remarks?: string | null;
          p_return_date?: string;
          p_new_status?: "Unassigned" | "In Repair" | "Retired";
        };
        Returns: undefined;
      };
      acknowledge_assignment: {
        Args: { p_assignment_id: string };
        Returns: undefined;
      };
      search_people: {
        Args: { p_query: string; p_limit?: number };
        Returns: {
          person_id: string;
          full_name: string;
          designation: string | null;
          employee_code: string | null;
        }[];
      };
      asset_person_names: {
        Args: { p_person_ids: string[] };
        Returns: {
          person_id: string;
          full_name: string;
          designation: string | null;
          employee_code: string | null;
        }[];
      };
      open_maintenance: {
        Args: {
          p_asset_id: string;
          p_issue_type: string;
          p_description?: string;
          p_service_date?: string;
        };
        Returns: string;
      };
      close_maintenance: {
        Args: {
          p_maintenance_id: string;
          p_resolution: string;
          p_cost?: number;
          p_returned_date?: string;
          p_remarks?: string;
        };
        Returns: undefined;
      };
    };
  };
};
