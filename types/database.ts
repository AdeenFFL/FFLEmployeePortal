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
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
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
    };
  };
};
