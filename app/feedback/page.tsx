import { listFeedbackDepartments } from "./actions";
import { FeedbackChat } from "./feedback-chat";
import { APP_NAME } from "@/lib/constants";

export const metadata = { title: `Anonymous Feedback — ${APP_NAME}` };

export default async function FeedbackPage() {
  const departments = await listFeedbackDepartments();

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-slate-50 px-4 py-16">
      <div className="mb-6 max-w-md text-center">
        <h1 className="text-2xl font-bold text-slate-900">Anonymous Feedback</h1>
        <p className="mt-2 text-sm text-slate-500">
          Talk to HR with no identity attached — no name, no email, nothing logged. Pick a
          department to get started.
        </p>
      </div>
      <FeedbackChat departments={departments} />
    </div>
  );
}
