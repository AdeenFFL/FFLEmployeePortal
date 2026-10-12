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
  it: {
    Tables: {
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
          Pick<Asset, "serial_number" | "asset_name" | "asset_type_id" | "company_id">;
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
    };
    Views: Record<string, never>;
    Functions: {
      next_number: {
        Args: { p_prefix: string; p_width?: number };
        Returns: string;
      };
    };
  };
};
