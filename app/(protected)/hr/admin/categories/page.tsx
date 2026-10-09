import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import {
  createCategory,
  toggleCategoryActive,
  deleteCategory,
  addCategoryAssignee,
  removeCategoryAssignee,
} from "./actions";

export default async function HrCategoriesAdminPage() {
  const supabase = await createClient();

  // persons(full_name) isn't embedded on ticket_category_assignees: person_id -> public.persons
  // is a cross-schema FK, which supabase-js can't type (see types/database.ts's note on
  // anonymous_conversations) — names are fetched separately below instead.
  const { data: categories } = await supabase
    .schema("hr")
    .from("ticket_categories")
    .select("id, name, description, is_active, ticket_category_assignees(person_id)")
    .order("name");

  const assigneeIds = [
    ...new Set((categories ?? []).flatMap((c) => c.ticket_category_assignees.map((a) => a.person_id))),
  ];
  const { data: assigneePeople } =
    assigneeIds.length > 0
      ? await supabase.from("persons").select("id, full_name").in("id", assigneeIds)
      : { data: [] };
  const assigneeNameById = new Map((assigneePeople ?? []).map((p) => [p.id, p.full_name]));

  return (
    <div className="py-6">
      <PageHeader
        title="Ticket Categories"
        description="Manage categories and who gets assigned tickets filed under each one."
      />

      <form
        action={createCategory}
        className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Name</label>
          <input
            name="name"
            required
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-700">Description</label>
          <input
            name="description"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Add Category
        </button>
      </form>

      <div className="space-y-4">
        {(categories ?? []).map((cat) => {
          const toggleAction = toggleCategoryActive.bind(null, cat.id, !cat.is_active);
          const deleteAction = deleteCategory.bind(null, cat.id);
          const addAssigneeAction = addCategoryAssignee.bind(null, cat.id);

          return (
            <div
              key={cat.id}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{cat.name}</p>
                  {cat.description && (
                    <p className="text-sm text-slate-500">{cat.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      cat.is_active
                        ? "bg-green-50 text-green-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {cat.is_active ? "Active" : "Inactive"}
                  </span>
                  <form action={toggleAction}>
                    <button
                      type="submit"
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {cat.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </form>
                  <form action={deleteAction}>
                    <button
                      type="submit"
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </div>

              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Assignees
                </p>
                <div className="mb-3 flex flex-wrap gap-2">
                  {cat.ticket_category_assignees.length === 0 && (
                    <p className="text-sm text-slate-400">No one assigned yet.</p>
                  )}
                  {cat.ticket_category_assignees.map((a) => {
                    const removeAction = removeCategoryAssignee.bind(
                      null,
                      cat.id,
                      a.person_id,
                    );
                    return (
                      <form key={a.person_id} action={removeAction}>
                        <button
                          type="submit"
                          className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 hover:bg-slate-200"
                          title="Remove"
                        >
                          {assigneeNameById.get(a.person_id) ?? "Unknown"} ✕
                        </button>
                      </form>
                    );
                  })}
                </div>
                <form action={addAssigneeAction} className="flex gap-2">
                  <input
                    name="email"
                    type="email"
                    placeholder="person@fauji.foods"
                    required
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                  <button
                    type="submit"
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    + Assign
                  </button>
                </form>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
