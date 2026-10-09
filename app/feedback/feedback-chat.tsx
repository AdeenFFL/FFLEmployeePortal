"use client";

import { useEffect, useRef, useState } from "react";
import {
  startAnonymousConversation,
  sendAnonymousMessage,
  getAnonymousConversation,
} from "./actions";

// The conversation id IS the access token (06-hr-module-design.md §3.1) — holding it in
// localStorage is the only continuity mechanism; there is no account, email, or recovery path
// behind it. Losing it means losing access to that conversation, permanently, by design.
const STORAGE_KEY = "ffl_anonymous_feedback_token";
const POLL_INTERVAL_MS = 8000;

type Department = { id: string; name: string };
type Message = { id: string; sender_type: "submitter" | "hr"; body: string; created_at: string };

export function FeedbackChat({ departments }: { departments: Department[] }) {
  const [token, setToken] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<"Open" | "Closed" | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setToken(localStorage.getItem(STORAGE_KEY));
    } catch {
      // Private browsing / blocked storage — fall back to "no saved conversation" rather than
      // crash; the submitter just starts a fresh one each visit.
    }
    setHydrated(true);
  }, []);

  async function refresh(conversationId: string) {
    const result = await getAnonymousConversation(conversationId);
    if (!result) {
      setError("That conversation token is no longer valid.");
      return;
    }
    setStatus(result.conversation.status);
    setMessages(result.messages);
  }

  useEffect(() => {
    if (!token) return;
    refresh(token);
    const interval = setInterval(() => refresh(token), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!departmentId) {
      setError("Please choose a department.");
      return;
    }
    if (!draft.trim()) {
      setError("Please write a message.");
      return;
    }
    setIsSending(true);
    try {
      const conversationId = await startAnonymousConversation(departmentId, draft);
      try {
        localStorage.setItem(STORAGE_KEY, conversationId);
      } catch {
        // Same storage caveat as above — the chat still works for this page view even if the
        // token can't be persisted, it just won't survive a reload.
      }
      setToken(conversationId);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSending(false);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !draft.trim()) return;
    setError(null);
    setIsSending(true);
    try {
      await sendAnonymousMessage(token, draft);
      setDraft("");
      await refresh(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSending(false);
    }
  }

  function startNewConversation() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // See storage caveats above.
    }
    setToken(null);
    setStatus(null);
    setMessages([]);
    setError(null);
  }

  if (!hydrated) return null;

  if (!token) {
    return (
      <form
        onSubmit={handleStart}
        className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Department</label>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">Choose a department…</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Your message</label>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            placeholder="Describe what's on your mind — no identifying details are stored."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={isSending}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSending ? "Sending…" : "Start anonymous conversation"}
        </button>
        <p className="text-xs text-slate-400">
          You'll get a private link token to check for replies. There is no way to recover it if
          lost — bookmark this page or save the token somewhere safe.
        </p>
      </form>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-slate-900">Anonymous conversation</p>
          <p className="text-xs text-slate-400">
            {status === "Closed" ? "Closed by HR" : "Open"}
          </p>
        </div>
        <button
          type="button"
          onClick={startNewConversation}
          className="text-xs text-slate-400 hover:text-slate-600"
        >
          Start a new one
        </button>
      </div>

      <div className="flex max-h-96 flex-col gap-3 overflow-y-auto px-4 py-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
              m.sender_type === "hr"
                ? "self-start bg-slate-100 text-slate-800"
                : "self-end bg-blue-600 text-white"
            }`}
          >
            <p>{m.body}</p>
            <p
              className={`mt-1 text-[10px] ${
                m.sender_type === "hr" ? "text-slate-400" : "text-blue-100"
              }`}
            >
              {m.sender_type === "hr" ? "HR" : "You"}
            </p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="border-t border-slate-200 p-3">
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        {status === "Closed" ? (
          <p className="text-center text-xs text-slate-400">
            This conversation is closed and can no longer accept replies.
          </p>
        ) : (
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a message…"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={isSending || !draft.trim()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
