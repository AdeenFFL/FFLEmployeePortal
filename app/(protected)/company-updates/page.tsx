import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserNav } from "../current-user";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { AnnouncementFormPanel } from "@/components/announcement-form";
import { PollFormPanel } from "@/components/poll-form";
import { BellIcon, BarChartIcon } from "@/components/icons";
import { deleteAnnouncement, closePoll, deletePoll, voteOnPoll } from "./actions";
import type { Announcement, PollOption } from "@/types/database";

const BASE_PATH = "/company-updates";

export default async function CompanyUpdatesPage({
  searchParams,
}: {
  searchParams: Promise<{ compose?: string; edit?: string }>;
}) {
  const { compose, edit } = await searchParams;
  const supabase = await createClient();
  const { roleName } = await getCurrentUserNav();
  const canCompose = roleName === "HR" || roleName === "Admin";

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: announcements } = await supabase
    .from("announcements")
    .select("*")
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });

  const { data: polls } = await supabase
    .from("polls")
    .select("*")
    .order("created_at", { ascending: false });

  const pollIds = (polls ?? []).map((p) => p.id);

  const { data: options } =
    pollIds.length > 0
      ? await supabase
          .from("poll_options")
          .select("*")
          .in("poll_id", pollIds)
          .order("sort_order")
      : { data: [] as PollOption[] };

  const { data: ownVotes } = user
    ? await supabase.from("poll_votes").select("poll_id, option_id").eq("voter_id", user.id)
    : { data: [] as { poll_id: string; option_id: string }[] };
  const ownVoteByPoll = new Map((ownVotes ?? []).map((v) => [v.poll_id, v.option_id]));

  const tallyByPoll = new Map<string, Map<string, number>>();
  await Promise.all(
    pollIds.map(async (pollId) => {
      const { data: results } = await supabase.rpc("poll_results", { p_poll_id: pollId });
      const tally = new Map<string, number>();
      for (const row of results ?? []) tally.set(row.option_id, row.vote_count);
      tallyByPoll.set(pollId, tally);
    }),
  );

  let editingAnnouncement: Announcement | null = null;
  if (edit) {
    const { data } = await supabase
      .from("announcements")
      .select("*")
      .eq("id", edit)
      .maybeSingle();
    editingAnnouncement = data ?? null;
  }

  return (
    <div className="py-6">
      <PageHeader
        title="Company Updates"
        description="News, announcements, and polls from across Fauji Foods."
        action={
          canCompose && (
            <div className="flex gap-2">
              <Link
                href={`${BASE_PATH}?compose=announcement`}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                + New Announcement
              </Link>
              <Link
                href={`${BASE_PATH}?compose=poll`}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                + New Poll
              </Link>
            </div>
          )
        }
      />

      <section id="announcements" className="mb-10 scroll-mt-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          <BellIcon className="h-4 w-4" />
          Announcements
        </h2>

        {(announcements ?? []).length === 0 && (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            No announcements yet.
          </p>
        )}

        <div className="flex flex-col gap-4">
          {(announcements ?? []).map((a) => (
            <div key={a.id} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-2 flex items-start justify-between gap-4">
                <div className="flex items-center gap-2">
                  {a.is_pinned && <StatusPill label="Pinned" tone="info" />}
                  <h3 className="text-base font-semibold text-slate-900">{a.title}</h3>
                </div>
                {canCompose && (
                  <div className="flex shrink-0 gap-3 text-xs">
                    <Link
                      href={`${BASE_PATH}?edit=${a.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      Edit
                    </Link>
                    <form action={deleteAnnouncement.bind(null, a.id)}>
                      <button type="submit" className="font-medium text-red-600 hover:underline">
                        Delete
                      </button>
                    </form>
                  </div>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-600">{a.body}</p>
              <p className="mt-3 text-xs text-slate-400">
                Posted {new Date(a.created_at).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section id="polls" className="scroll-mt-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          <BarChartIcon className="h-4 w-4" />
          Polls
        </h2>

        {(polls ?? []).length === 0 && (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            No polls yet.
          </p>
        )}

        <div className="flex flex-col gap-4">
          {(polls ?? []).map((poll) => {
            const pollOptions = (options ?? []).filter((o) => o.poll_id === poll.id);
            const tally = tallyByPoll.get(poll.id) ?? new Map<string, number>();
            const total = pollOptions.reduce((sum, o) => sum + (tally.get(o.id) ?? 0), 0);
            const ownVote = ownVoteByPoll.get(poll.id);

            return (
              <div
                key={poll.id}
                className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <h3 className="text-base font-semibold text-slate-900">{poll.question}</h3>
                  <StatusPill
                    label={poll.status}
                    tone={poll.status === "Open" ? "positive" : "neutral"}
                  />
                </div>

                {poll.status === "Open" ? (
                  <form action={voteOnPoll.bind(null, poll.id)} className="flex flex-col gap-3">
                    {pollOptions.map((option) => {
                      const count = tally.get(option.id) ?? 0;
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      return (
                        <label
                          key={option.id}
                          className="flex cursor-pointer flex-col gap-1.5 rounded-lg border border-slate-200 p-3 hover:bg-slate-50"
                        >
                          <span className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="radio"
                              name="option_id"
                              value={option.id}
                              defaultChecked={ownVote === option.id}
                              className="h-4 w-4"
                            />
                            {option.label}
                            <span className="ml-auto text-xs text-slate-400">
                              {count} vote{count === 1 ? "" : "s"} ({pct}%)
                            </span>
                          </span>
                          <span className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                            <span
                              className="block h-full rounded-full bg-blue-500"
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                        </label>
                      );
                    })}
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <button
                        type="submit"
                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                      >
                        {ownVote ? "Update Vote" : "Vote"}
                      </button>
                      {canCompose && (
                        <div className="flex gap-3 text-xs">
                          <form action={closePoll.bind(null, poll.id)}>
                            <button
                              type="submit"
                              className="font-medium text-slate-600 hover:underline"
                            >
                              Close Poll
                            </button>
                          </form>
                          <form action={deletePoll.bind(null, poll.id)}>
                            <button
                              type="submit"
                              className="font-medium text-red-600 hover:underline"
                            >
                              Delete
                            </button>
                          </form>
                        </div>
                      )}
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-col gap-3">
                    {pollOptions.map((option) => {
                      const count = tally.get(option.id) ?? 0;
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      return (
                        <div key={option.id} className="flex flex-col gap-1.5">
                          <span className="flex items-center gap-2 text-sm text-slate-700">
                            {option.label}
                            <span className="ml-auto text-xs text-slate-400">
                              {count} vote{count === 1 ? "" : "s"} ({pct}%)
                            </span>
                          </span>
                          <span className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                            <span
                              className="block h-full rounded-full bg-slate-400"
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                        </div>
                      );
                    })}
                    {canCompose && (
                      <form action={deletePoll.bind(null, poll.id)} className="mt-1">
                        <button
                          type="submit"
                          className="text-xs font-medium text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {canCompose && compose === "announcement" && (
        <AnnouncementFormPanel basePath={BASE_PATH} mode="new" initialValues={null} />
      )}
      {canCompose && compose === "poll" && <PollFormPanel basePath={BASE_PATH} />}
      {canCompose && editingAnnouncement && (
        <AnnouncementFormPanel
          basePath={BASE_PATH}
          mode="edit"
          initialValues={editingAnnouncement}
        />
      )}
    </div>
  );
}
