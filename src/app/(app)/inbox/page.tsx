"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCheck, MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner } from "@/components/ui";
import { RichComposer } from "@/components/rich-composer";
import { sanitizeHtml, htmlToText } from "@/lib/rich-text";
import { formatDateTime, cn } from "@/lib/utils";

type Msg = {
  id: number;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

type DirUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  avatar_url: string | null;
};

type Summaries = {
  last: Record<string, Msg>;
  unread: Record<string, number>;
};

function displayName(u: DirUser): string {
  return u.full_name || u.email || "—";
}

function initialsOf(u: DirUser): string {
  const name = (u.full_name || u.email || "").trim();
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  const ini = parts.map((p) => p[0]).join("").toUpperCase();
  return ini || "?";
}

export default function InboxPage() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);

  const [myId, setMyId] = useState<string | null>(null);
  const [users, setUsers] = useState<DirUser[]>([]);
  const [summaries, setSummaries] = useState<Summaries>({ last: {}, unread: {} });
  const [listLoading, setListLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<Msg[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);

  const selectedRef = useRef<string | null>(null);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread, threadLoading]);

  // who am I
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      setMyId(data.user?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // directory + recent messages -> conversation summaries (initial load + 20s poll fallback)
  useEffect(() => {
    if (!myId) return;
    let cancelled = false;
    const load = async () => {
      const [dir, msgs] = await Promise.all([
        supabase.rpc("fn_user_directory"),
        supabase
          .from("messages")
          .select("id, sender_id, recipient_id, body, created_at, read_at")
          .or(`sender_id.eq.${myId},recipient_id.eq.${myId}`)
          .order("created_at", { ascending: false })
          .limit(400),
      ]);
      if (cancelled) return;
      const dirRows = ((dir.data as DirUser[] | null) ?? []).filter((u) => u.id !== myId);
      setUsers(dirRows);
      const rows = (msgs.data as Msg[] | null) ?? [];
      const last: Record<string, Msg> = {};
      const unread: Record<string, number> = {};
      for (const m of rows) {
        const other = m.sender_id === myId ? m.recipient_id : m.sender_id;
        if (!last[other]) last[other] = m;
        if (m.recipient_id === myId && !m.read_at) unread[other] = (unread[other] ?? 0) + 1;
      }
      // the open thread is marked read server-side on open; keep the UI consistent
      if (selectedRef.current) unread[selectedRef.current] = 0;
      setSummaries({ last, unread });
      setListLoading(false);
    };
    load();
    const iv = setInterval(load, 20000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [myId, supabase]);

  const markRead = useCallback(
    async (other: string) => {
      if (!myId) return;
      await supabase
        .from("messages")
        .update({ read_at: new Date().toISOString() })
        .eq("recipient_id", myId)
        .eq("sender_id", other)
        .is("read_at", null);
      setSummaries((s) => ({ ...s, unread: { ...s.unread, [other]: 0 } }));
    },
    [myId, supabase]
  );

  // full history for the selected conversation
  useEffect(() => {
    if (!myId || !selected) {
      setThread([]);
      return;
    }
    let cancelled = false;
    setThreadLoading(true);
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("id, sender_id, recipient_id, body, created_at, read_at")
        .or(
          `and(sender_id.eq.${myId},recipient_id.eq.${selected}),and(sender_id.eq.${selected},recipient_id.eq.${myId})`
        )
        .order("created_at", { ascending: true })
        .limit(500);
      if (cancelled) return;
      setThread((data as Msg[]) ?? []);
      setThreadLoading(false);
      markRead(selected);
    })();
    return () => {
      cancelled = true;
    };
  }, [myId, selected, supabase, markRead]);

  // realtime: new messages addressed to me
  useEffect(() => {
    if (!myId) return;
    const ch = supabase
      .channel(`inbox-${myId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${myId}` },
        (payload) => {
          const m = payload.new as Msg;
          const inOpenThread = m.sender_id === selectedRef.current;
          if (inOpenThread) {
            setThread((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
            markRead(m.sender_id);
          }
          setSummaries((s) => ({
            last: { ...s.last, [m.sender_id]: m },
            unread: {
              ...s.unread,
              [m.sender_id]: inOpenThread ? 0 : (s.unread[m.sender_id] ?? 0) + 1,
            },
          }));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [myId, supabase, markRead]);

  async function send(html: string) {
    if (!myId || !selected) return;
    const { data } = await supabase
      .from("messages")
      .insert({ sender_id: myId, recipient_id: selected, body: html })
      .select()
      .single();
    if (!data) return;
    const m = data as Msg;
    setThread((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    setSummaries((s) => ({ ...s, last: { ...s.last, [m.recipient_id]: m } }));
  }

  // users with a conversation first (latest message desc), then the rest A→Z
  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      const la = summaries.last[a.id];
      const lb = summaries.last[b.id];
      if (la && lb) return lb.created_at.localeCompare(la.created_at);
      if (la) return -1;
      if (lb) return 1;
      return displayName(a).localeCompare(displayName(b), "ar");
    });
  }, [users, summaries]);

  const selectedUser = selected ? users.find((u) => u.id === selected) ?? null : null;

  return (
    <div>
      <PageHeader title={t("inbox")} subtitle={t("inboxSubtitle")} />

      <div className="card flex h-[calc(100vh-12rem)] overflow-hidden p-0">
        {/* Conversation list */}
        <div
          className={cn(
            "w-full shrink-0 flex-col border-e border-slate-200 sm:flex sm:w-72",
            selected ? "hidden" : "flex"
          )}
        >
          <div className="border-b border-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("online")}
          </div>
          <div className="flex-1 overflow-y-auto">
            {listLoading ? (
              <Spinner />
            ) : (
              sortedUsers.map((u) => {
                const last = summaries.last[u.id];
                const unread = summaries.unread[u.id] ?? 0;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setSelected(u.id)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-slate-50",
                      selected === u.id && "bg-brand-50"
                    )}
                  >
                    {u.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                        {initialsOf(u)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-slate-800">{displayName(u)}</span>
                        {last && (
                          <span dir="ltr" className="shrink-0 text-[10px] text-slate-400">
                            {formatDateTime(last.created_at)}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-slate-500" dir="auto">
                          {last
                            ? `${last.sender_id === myId ? `${t("sentLabel")} ` : ""}${htmlToText(last.body, 60)}`
                            : u.email}
                        </span>
                        {unread > 0 && (
                          <span
                            title={t("unread")}
                            className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white"
                          >
                            {unread}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Thread */}
        <div className={cn("min-w-0 flex-1 flex-col sm:flex", selected ? "flex" : "hidden")}>
          {!selectedUser ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400">
              <MessageSquare size={40} strokeWidth={1.5} />
              <p className="text-sm">{t("selectConversation")}</p>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
                <button
                  type="button"
                  className="rounded-md p-1 text-slate-500 hover:bg-slate-100 sm:hidden"
                  onClick={() => setSelected(null)}
                  aria-label={t("inbox")}
                >
                  <ArrowLeft size={18} className="rtl:-scale-x-100" />
                </button>
                {selectedUser.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selectedUser.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                    {initialsOf(selectedUser)}
                  </span>
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-slate-800">{displayName(selectedUser)}</div>
                  {selectedUser.email && (
                    <div dir="ltr" className="truncate text-xs text-slate-400">
                      {selectedUser.email}
                    </div>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {threadLoading ? (
                  <Spinner />
                ) : thread.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    {t("noMessages")}
                  </div>
                ) : (
                  thread.map((m) => {
                    const mine = m.sender_id === myId;
                    return (
                      <div key={m.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
                        <div
                          dir="auto"
                          className={cn(
                            "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:list-decimal [&_ol]:ps-5",
                            mine ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800"
                          )}
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(m.body) }}
                        />
                        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
                          <span dir="ltr">{formatDateTime(m.created_at)}</span>
                          {mine && (
                            <CheckCheck size={13} className={m.read_at ? "text-sky-500" : "text-slate-400"} />
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              {/* Composer */}
              <div className="border-t border-slate-100 p-3">
                <RichComposer onSend={send} placeholder={t("typeMessage")} disabled={!myId} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
