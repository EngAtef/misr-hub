"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCheck, Megaphone, MessageSquare, Paperclip } from "lucide-react";
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
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_size: number | null;
};

type Announcement = {
  id: number;
  sender_id: string;
  sender_email: string;
  body: string;
  created_at: string;
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

const ANNOUNCEMENTS_ID = "__announcements__";

const MSG_COLUMNS =
  "id, sender_id, recipient_id, body, created_at, read_at, attachment_path, attachment_name, attachment_type, attachment_size";

const NAME_COLORS = [
  "text-rose-600",
  "text-amber-600",
  "text-emerald-600",
  "text-sky-600",
  "text-violet-600",
  "text-fuchsia-600",
];

function nameColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

function displayName(u: DirUser): string {
  return u.full_name || u.email || "—";
}

function initialsOf(u: DirUser): string {
  const name = (u.full_name || u.email || "").trim();
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  const ini = parts.map((p) => p[0]).join("").toUpperCase();
  return ini || "?";
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function InboxPage() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);

  const [myId, setMyId] = useState<string | null>(null);
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [myName, setMyName] = useState<string | null>(null);
  const [users, setUsers] = useState<DirUser[]>([]);
  const [summaries, setSummaries] = useState<Summaries>({ last: {}, unread: {} });
  const [listLoading, setListLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<Msg[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [annLoading, setAnnLoading] = useState(true);
  const [annUnread, setAnnUnread] = useState(0);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  const selectedRef = useRef<string | null>(null);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread, threadLoading, announcements, annLoading, selected]);

  // who am I
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      setMyId(data.user?.id ?? null);
      setMyEmail(data.user?.email ?? null);
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
          .select(MSG_COLUMNS)
          .or(`sender_id.eq.${myId},recipient_id.eq.${myId}`)
          .order("created_at", { ascending: false })
          .limit(400),
      ]);
      if (cancelled) return;
      const allRows = (dir.data as DirUser[] | null) ?? [];
      const me = allRows.find((u) => u.id === myId);
      if (me) setMyName(me.full_name || me.email);
      setUsers(allRows.filter((u) => u.id !== myId));
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

  // announcements (last 30 days) + my read marker -> unread badge
  useEffect(() => {
    if (!myId) return;
    let cancelled = false;
    (async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [ann, read] = await Promise.all([
        supabase
          .from("announcements")
          .select("id, sender_id, sender_email, body, created_at")
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .limit(200),
        supabase.from("announcement_reads").select("last_read_at").eq("user_id", myId).maybeSingle(),
      ]);
      if (cancelled) return;
      const rows = (ann.data as Announcement[] | null) ?? [];
      setAnnouncements(rows);
      const lastRead = (read.data as { last_read_at: string } | null)?.last_read_at ?? null;
      if (selectedRef.current !== ANNOUNCEMENTS_ID) {
        setAnnUnread(rows.filter((a) => (lastRead ? a.created_at > lastRead : true)).length);
      }
      setAnnLoading(false);
    })();
    return () => {
      cancelled = true;
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

  const markAnnRead = useCallback(async () => {
    if (!myId) return;
    setAnnUnread(0);
    await supabase
      .from("announcement_reads")
      .upsert({ user_id: myId, last_read_at: new Date().toISOString() });
  }, [myId, supabase]);

  // opening the announcements thread clears its badge
  useEffect(() => {
    if (selected === ANNOUNCEMENTS_ID) markAnnRead();
  }, [selected, markAnnRead]);

  // full history for the selected conversation
  useEffect(() => {
    if (!myId || !selected || selected === ANNOUNCEMENTS_ID) {
      setThread([]);
      return;
    }
    let cancelled = false;
    setThreadLoading(true);
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select(MSG_COLUMNS)
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

  // signed URLs for attachments visible in the open thread
  useEffect(() => {
    const paths = thread
      .map((m) => m.attachment_path)
      .filter((p): p is string => !!p)
      .filter((p) => !signedUrls[p]);
    if (paths.length === 0) return;
    let cancelled = false;
    (async () => {
      const fresh: Record<string, string> = {};
      for (const p of paths) {
        const { data } = await supabase.storage.from("chat-uploads").createSignedUrl(p, 3600);
        if (data?.signedUrl) fresh[p] = data.signedUrl;
      }
      if (!cancelled && Object.keys(fresh).length > 0) setSignedUrls((s) => ({ ...s, ...fresh }));
    })();
    return () => {
      cancelled = true;
    };
  }, [thread, signedUrls, supabase]);

  // realtime: new messages addressed to me + new announcements
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
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "announcements" },
        (payload) => {
          const a = payload.new as Announcement;
          if (a.sender_id === myId) return; // already appended locally after insert
          setAnnouncements((prev) => (prev.some((x) => x.id === a.id) ? prev : [...prev, a]));
          if (selectedRef.current === ANNOUNCEMENTS_ID) {
            markAnnRead();
          } else {
            setAnnUnread((n) => n + 1);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [myId, supabase, markRead, markAnnRead]);

  const mentionUsers = useMemo(
    () =>
      users
        .map((u) => ({ id: u.id, name: u.full_name || u.email || "" }))
        .filter((u) => u.name !== ""),
    [users]
  );

  // fire-and-forget @mention notifications for a sent body
  function notifyMentions(html: string, dmRecipient: string | null) {
    if (!myId) return;
    const text = htmlToText(html, 10000);
    const rows = users
      .filter((u) => u.id !== dmRecipient)
      .filter((u) => {
        const name = u.full_name || u.email;
        return !!name && text.includes(`@${name}`);
      })
      .map((u) => ({
        recipient_id: u.id,
        sender_id: myId,
        sender_email: myEmail ?? "",
        title: `${myName ?? myEmail ?? ""} ${t("mentionedYou")}`,
        body: text.slice(0, 120),
        link: "/inbox",
      }));
    if (rows.length === 0) return;
    void supabase
      .from("notifications")
      .insert(rows)
      .then(
        () => undefined,
        () => undefined
      );
  }

  async function send(html: string) {
    if (!myId || !selected || selected === ANNOUNCEMENTS_ID) return;
    const { data } = await supabase
      .from("messages")
      .insert({ sender_id: myId, recipient_id: selected, body: html })
      .select()
      .single();
    if (!data) return;
    const m = data as Msg;
    setThread((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    setSummaries((s) => ({ ...s, last: { ...s.last, [m.recipient_id]: m } }));
    notifyMentions(html, m.recipient_id);
  }

  async function sendAnnouncement(html: string) {
    if (!myId) return;
    const { data } = await supabase
      .from("announcements")
      .insert({ sender_id: myId, sender_email: myEmail ?? "", body: html })
      .select()
      .single();
    if (!data) return;
    const a = data as Announcement;
    setAnnouncements((prev) => (prev.some((x) => x.id === a.id) ? prev : [...prev, a]));
    notifyMentions(html, null);
  }

  async function attach(file: File) {
    if (!myId || !selected || selected === ANNOUNCEMENTS_ID) return;
    if (file.size > 10 * 1024 * 1024) {
      alert(t("attachTooLarge"));
      return;
    }
    const path = `${myId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const { error } = await supabase.storage.from("chat-uploads").upload(path, file);
    if (error) return;
    const { data } = await supabase
      .from("messages")
      .insert({
        sender_id: myId,
        recipient_id: selected,
        body: `📎 ${file.name}`,
        attachment_path: path,
        attachment_name: file.name,
        attachment_type: file.type,
        attachment_size: file.size,
      })
      .select()
      .single();
    if (!data) return;
    const m = data as Msg;
    setThread((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    setSummaries((s) => ({ ...s, last: { ...s.last, [m.recipient_id]: m } }));
  }

  function annSenderName(a: Announcement): string {
    if (a.sender_id === myId) return myName ?? a.sender_email;
    const u = users.find((x) => x.id === a.sender_id);
    return u ? displayName(u) : a.sender_email;
  }

  function renderAttachment(m: Msg) {
    const path = m.attachment_path as string;
    const url = signedUrls[path];
    if (m.attachment_type?.startsWith("image/") && url) {
      return (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={m.attachment_name ?? ""} className="max-h-64 rounded-lg" />
        </a>
      );
    }
    const mine = m.sender_id === myId;
    return (
      <a
        href={url ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "flex items-center gap-2 text-sm",
          mine ? "text-white" : "text-slate-800",
          !url && "pointer-events-none opacity-60"
        )}
      >
        <Paperclip size={14} className="shrink-0" />
        <span className="truncate font-semibold" dir="auto">
          {m.attachment_name}
        </span>
        <span className={cn("shrink-0 text-[10px]", mine ? "text-white/70" : "text-slate-400")} dir="ltr">
          {formatSize(m.attachment_size ?? 0)}
        </span>
      </a>
    );
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

  const selectedUser =
    selected && selected !== ANNOUNCEMENTS_ID ? users.find((u) => u.id === selected) ?? null : null;
  const lastAnn = announcements.length > 0 ? announcements[announcements.length - 1] : null;

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
            {/* Pinned team announcements channel */}
            <button
              type="button"
              onClick={() => setSelected(ANNOUNCEMENTS_ID)}
              className={cn(
                "flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-start hover:bg-slate-50",
                selected === ANNOUNCEMENTS_ID && "bg-brand-50"
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
                <Megaphone size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-800">
                    {t("announcementsLbl")}
                  </span>
                  {lastAnn && (
                    <span dir="ltr" className="shrink-0 text-[10px] text-slate-400">
                      {formatDateTime(lastAnn.created_at)}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-slate-500" dir="auto">
                    {lastAnn
                      ? `${annSenderName(lastAnn)}: ${htmlToText(lastAnn.body, 60)}`
                      : t("noMessages")}
                  </span>
                  {annUnread > 0 && (
                    <span
                      title={t("unread")}
                      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white"
                    >
                      {annUnread}
                    </span>
                  )}
                </span>
              </span>
            </button>
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
          {selected === ANNOUNCEMENTS_ID ? (
            <>
              {/* Announcements header */}
              <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
                <button
                  type="button"
                  className="rounded-md p-1 text-slate-500 hover:bg-slate-100 sm:hidden"
                  onClick={() => setSelected(null)}
                  aria-label={t("inbox")}
                >
                  <ArrowLeft size={18} className="rtl:-scale-x-100" />
                </button>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-white">
                  <Megaphone size={16} />
                </span>
                <div className="truncate text-sm font-bold text-slate-800">{t("announcementsLbl")}</div>
              </div>

              {/* Announcements thread */}
              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {annLoading ? (
                  <Spinner />
                ) : announcements.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    {t("noMessages")}
                  </div>
                ) : (
                  announcements.map((a) => {
                    const mine = a.sender_id === myId;
                    return (
                      <div key={a.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
                        {!mine && (
                          <div className={cn("mb-0.5 text-[11px] font-semibold", nameColor(a.sender_id))}>
                            {annSenderName(a)}
                          </div>
                        )}
                        <div
                          dir="auto"
                          className={cn(
                            "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:list-decimal [&_ol]:ps-5",
                            mine ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800"
                          )}
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(a.body) }}
                        />
                        <div className="mt-0.5 text-[10px] text-slate-400" dir="ltr">
                          {formatDateTime(a.created_at)}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              {/* Announcements composer (no attachments here) */}
              <div className="border-t border-slate-100 p-3">
                <RichComposer
                  onSend={sendAnnouncement}
                  placeholder={t("typeMessage")}
                  disabled={!myId}
                  mentionUsers={mentionUsers}
                />
              </div>
            </>
          ) : !selectedUser ? (
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
                        {m.attachment_path ? (
                          <div
                            className={cn(
                              "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm",
                              mine ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800"
                            )}
                          >
                            {renderAttachment(m)}
                          </div>
                        ) : (
                          <div
                            dir="auto"
                            className={cn(
                              "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:list-decimal [&_ol]:ps-5",
                              mine ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800"
                            )}
                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(m.body) }}
                          />
                        )}
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
                <RichComposer
                  onSend={send}
                  placeholder={t("typeMessage")}
                  disabled={!myId}
                  mentionUsers={mentionUsers}
                  onAttach={attach}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
