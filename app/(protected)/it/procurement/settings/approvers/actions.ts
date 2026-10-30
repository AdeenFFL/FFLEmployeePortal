"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";

// Department approvers (09 addition P3, javaria_it_0011). RLS: it.procurement_settings.update.

const PATH = "/it/procurement/settings/approvers";

function go(kind: "error" | "notice", message: string, departmentId?: string): never {
  const dept = departmentId ? `&dept=${encodeURIComponent(departmentId)}#dept-${departmentId}` : "";
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}${dept}`);
}

function done(message: string, departmentId?: string): never {
  revalidatePath(PATH);
  revalidatePath("/it/procurement/approvals");
  go("notice", message, departmentId);
}

export async function addApprover(departmentId: string, formData: FormData) {
  const { supabase, personId } = await requirePermission("it.procurement_settings.update");
  const approverId = String(formData.get("personId") ?? "");
  if (!approverId) go("error", "Select a person.", departmentId);

  const { error } = await supabase.schema("it").from("department_approvers").insert({
    department_id: departmentId,
    person_id: approverId,
    can_approve_demands: true,
    can_approve_invoices: formData.get("invoices") === "on",
    created_by: personId,
  });
  if (error) {
    go("error", error.code === "23505" ? "That person is already an approver here." : error.message, departmentId);
  }

  done("Approver added.", departmentId);
}

export async function setApproverScope(
  departmentId: string,
  approverId: string,
  field: "can_approve_demands" | "can_approve_invoices",
  value: boolean,
) {
  const { supabase } = await requirePermission("it.procurement_settings.update");

  const { error } = await supabase
    .schema("it")
    .from("department_approvers")
    .update(field === "can_approve_demands" ? { can_approve_demands: value } : { can_approve_invoices: value })
    .eq("department_id", departmentId)
    .eq("person_id", approverId);
  if (error) go("error", error.message, departmentId);

  done("Approver updated.", departmentId);
}

export async function removeApprover(departmentId: string, approverId: string) {
  const { supabase } = await requirePermission("it.procurement_settings.update");

  const { error } = await supabase
    .schema("it")
    .from("department_approvers")
    .delete()
    .eq("department_id", departmentId)
    .eq("person_id", approverId);
  if (error) go("error", error.message, departmentId);

  done("Approver removed. Demands already decided keep their record.", departmentId);
}
