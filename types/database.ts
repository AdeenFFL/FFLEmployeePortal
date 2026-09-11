// Hand-written types mirroring supabase/migrations/0001-0008 (persons/user_accounts/user_roles
// identity split — see 0008_org_hierarchy_fix_and_identity_split.sql), shaped to match what
// `supabase gen types typescript` would produce (Row/Insert/Update/Relationships per table).
// No live-generated types exist yet. Once convenient, replace this file with the output of:
//   npx supabase gen types typescript --project-id <ref> > types/database.ts
//
// NOTE: these must stay `type` aliases, not `interface` declarations — interfaces don't get the
// implicit index signature TS needs to satisfy supabase-js's `Record<string, GenericTable>`
// constraint, which silently degrades every `.from(...)` call's inferred row type to `never`.

export type UserStatus = "Active" | "Inactive" | "Suspended";
export type DocumentVerificationStatus = "Pending" | "Verified" | "Rejected";
export type DependentStatus = "Pending HR Approval" | "Approved" | "Rejected";
export type OrgUnitType = "Department" | "Site";
export type OrgUnitSiteType = "plant" | "warehouse" | "shop" | "head_office" | "mess" | "other";
export type AuditAction = "CREATED" | "MODIFIED" | "DELETED" | "SYNCED";
export type AuthMethod = "microsoft" | "password" | "phone_otp";
export type PollStatus = "Open" | "Closed";
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
  description: string | null;
  created_at: string;
};

export type RolePermission = {
  role_id: string;
  permission_id: string;
  granted_by: string | null;
  granted_at: string | null;
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

export type EducationalDocument = {
  id: string;
  person_id: string;
  document_name: string;
  storage_path: string;
  verification_status: DocumentVerificationStatus;
  created_at: string;
};

export type Dependent = {
  id: string;
  person_id: string;
  name: string;
  relationship: string;
  cnic_or_bform: string | null;
  date_of_birth: string | null;
  supporting_document_path: string | null;
  status: DependentStatus;
  created_at: string;
  updated_at: string;
};

export type InsurancePolicy = {
  id: string;
  person_id: string;
  provider: string | null;
  policy_number: string | null;
  coverage_type: string | null;
  coverage_limit: number | null;
  created_at: string;
  updated_at: string;
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

export type Announcement = {
  id: string;
  title: string;
  body: string;
  is_pinned: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Poll = {
  id: string;
  question: string;
  status: PollStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PollOption = {
  id: string;
  poll_id: string;
  label: string;
  sort_order: number;
};

export type PollVote = {
  id: string;
  poll_id: string;
  option_id: string;
  voter_id: string;
  voted_at: string;
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
        Insert: Partial<Permission> & Pick<Permission, "key">;
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
      educational_documents: {
        Row: EducationalDocument;
        Insert: Partial<EducationalDocument> &
          Pick<EducationalDocument, "person_id" | "document_name" | "storage_path">;
        Update: Partial<EducationalDocument>;
        Relationships: [
          {
            foreignKeyName: "educational_documents_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "persons";
            referencedColumns: ["id"];
          },
        ];
      };
      dependents: {
        Row: Dependent;
        Insert: Partial<Dependent> & Pick<Dependent, "person_id" | "name" | "relationship">;
        Update: Partial<Dependent>;
        Relationships: [
          {
            foreignKeyName: "dependents_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "persons";
            referencedColumns: ["id"];
          },
        ];
      };
      insurance_policies: {
        Row: InsurancePolicy;
        Insert: Partial<InsurancePolicy> & Pick<InsurancePolicy, "person_id">;
        Update: Partial<InsurancePolicy>;
        Relationships: [
          {
            foreignKeyName: "insurance_policies_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: true;
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
      announcements: {
        Row: Announcement;
        Insert: Partial<Announcement> & Pick<Announcement, "title" | "body">;
        Update: Partial<Announcement>;
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "persons";
            referencedColumns: ["id"];
          },
        ];
      };
      polls: {
        Row: Poll;
        Insert: Partial<Poll> & Pick<Poll, "question">;
        Update: Partial<Poll>;
        Relationships: [
          {
            foreignKeyName: "polls_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "persons";
            referencedColumns: ["id"];
          },
        ];
      };
      poll_options: {
        Row: PollOption;
        Insert: Partial<PollOption> & Pick<PollOption, "poll_id" | "label">;
        Update: Partial<PollOption>;
        Relationships: [
          {
            foreignKeyName: "poll_options_poll_id_fkey";
            columns: ["poll_id"];
            isOneToOne: false;
            referencedRelation: "polls";
            referencedColumns: ["id"];
          },
        ];
      };
      poll_votes: {
        Row: PollVote;
        Insert: Partial<PollVote> & Pick<PollVote, "poll_id" | "option_id" | "voter_id">;
        Update: Partial<PollVote>;
        Relationships: [
          {
            foreignKeyName: "poll_votes_poll_id_fkey";
            columns: ["poll_id"];
            isOneToOne: false;
            referencedRelation: "polls";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "poll_votes_option_id_fkey";
            columns: ["option_id"];
            isOneToOne: false;
            referencedRelation: "poll_options";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "poll_votes_voter_id_fkey";
            columns: ["voter_id"];
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
      cast_poll_vote: {
        Args: { p_poll_id: string; p_option_id: string };
        Returns: undefined;
      };
      poll_results: {
        Args: { p_poll_id: string };
        Returns: { option_id: string; vote_count: number }[];
      };
    };
  };
};
