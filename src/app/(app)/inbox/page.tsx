"use client";

// Team inbox: pinned announcements + conversations (1:1 and named groups).
// Data model (migration 112): chat_conversations / chat_members /
// chat_messages, RLS by membership; the old 1:1 `messages` table is no
// longer read here (history hidden for now, nothing deleted).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCheck, Megaphone, MessageSquare, Paperclip, Plus, Users2, X, Settings2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner } from "@/components/ui";
import { RichComposer } from "@/components/rich-composer";
import { sanitizeHtml, htmlToText } from "@/lib/rich-text";
import { formatDateTime, cn } from "@/lib/utils";
import { notifyDialog, confirmDialog } from "@/components/dialog";

type Msg = {
  id: number;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_size: number | null;
};

type Conversation = {
  id: string;
  kind: "dm" | "group";
  name: string | null;
  created_by: string;
  created_at: string;
  last_read_at: string | null;
  members: { user_id: string; last_read_at: string | null }[];
  last: Msg | null;
  unread: number;
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

const ANNOUNCEMENTS_ID = "__announcements__";
const MSG_COLUMNS =
  "id, conversation_id, sender_id, body, created_at, attachment_path, attachment_name, attachment_type, attachment_size";

const NAME_COLORS = ["text-rose-600", "text-amber-600", "text-emerald-600", "text-sky-600", "text-violet-600", "text-fuchsia-600"];
function nameColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}
function displayName(u: DirUser | undefined | null): string {
  return u ? u.full_name || u.email || "—" : "—";
}
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]).join("").toUpperCase() || "?";
}
function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function InboxPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);

  const [myId, setMyId] = useState<string | null>(null);
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [myName, setMyName] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [users, setUsers] = useState<DirUser[]>([]);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<Msg[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [annLoading, setAnnLoading] = useState(true);
  const [annUnread, setAnnUnread] = useState(0);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [groupModal, setGroupModal] = useState<null | { mode: "create" } | { mode: "edit"; conv: Conversation }>(null);
  const [showPeople, setShowPeople] = useState(false);

  const selectedRef = useRef<string | null>(null);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread, threadLoading, announcements, annLoading, selected]);

  const userById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);

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

  // directory + conversation summaries (initial load + 20s poll fallback)
  const loadSummaries = useCallback(async () => {
    if (!myId) return;
    const [dir, sums] = await Promise.all([supabase.rpc("fn_user_directory"), supabase.rpc("fn_chat_summaries")]);
    const allRows = (dir.data as DirUser[] | null) ?? [];
    const me = allRows.find((u) => u.id === myId);
    if (me) {
      setMyName(me.full_name || me.email);
      setMyRole(me.role);
    }
    setUsers(allRows.filter((u) => u.id !== myId));
    const list = ((sums.data as Conversation[] | null) ?? []).map((c) => ({
      ...c,
      unread: selectedRef.current === c.id ? 0 : c.unread,
    }));
    setConvs(list);
    setListLoading(false);
  }, [myId, supabase]);

  useEffect(() => {
    if (!myId) return;
    loadSummaries();
    const iv = setInterval(loadSummaries, 20000);
    return () => clearInterval(iv);
  }, [myId, loadSummaries]);

  // announcements (last 30 days) + read marker
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
    async (convId: string) => {
      if (!myId) return;
      const now = new Date().toISOString();
      setConvs((cs) => cs.map((c) => (c.id === convId ? { ...c, unread: 0, last_read_at: now } : c)));
      await supabase.from("chat_members").update({ last_read_at: now }).eq("conversation_id", convId).eq("user_id", myId);
    },
    [myId, supabase]
  );

  const markAnnRead = useCallback(async () => {
    if (!myId) return;
    setAnnUnread(0);
    await supabase.from("announcement_reads").upsert({ user_id: myId, last_read_at: new Date().toISOString() });
  }, [myId, supabase]);

  useEffect(() => {
    if (selected === ANNOUNCEMENTS_ID) markAnnRead();
  }, [selected, markAnnRead]);

  // full thread for the selected conversation
  useEffect(() => {
    if (!myId || !selected || selected === ANNOUNCEMENTS_ID) {
      setThread([]);
      return;
    }
    let cancelled = false;
    setThreadLoading(true);
    (async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select(MSG_COLUMNS)
        .eq("conversation_id", selected)
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

  // signed URLs for attachments in the open thread
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

  // realtime: new messages in any of my conversations (RLS scopes the stream) + announcements
  useEffect(() => {
    if (!myId) return;
    const ch = supabase
      .channel(`chat-${myId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
        const m = payload.new as Msg;
        if (m.sender_id === myId) return; // appended locally on send
        const inOpen = m.conversation_id === selectedRef.current;
        if (inOpen) {
          setThread((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          markRead(m.conversation_id);
        }
        setConvs((cs) => {
          const known = cs.some((c) => c.id === m.conversation_id);
          if (!known) {
            // a group I was just added to — reload the list
            loadSummaries();
            return cs;
          }
          return cs
            .map((c) => (c.id === m.conversation_id ? { ...c, last: m, unread: inOpen ? 0 : c.unread + 1 } : c))
            .sort((a, b) => (b.last?.created_at ?? b.created_at).localeCompare(a.last?.created_at ?? a.created_at));
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcements" }, (payload) => {
        const a = payload.new as Announcement;
        if (a.sender_id === myId) return;
        setAnnouncements((prev) => (prev.some((x) => x.id === a.id) ? prev : [...prev, a]));
        if (selectedRef.current === ANNOUNCEMENTS_ID) markAnnRead();
        else setAnnUnread((n) => n + 1);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [myId, supabase, markRead, markAnnRead, loadSummaries]);

  const mentionUsers = useMemo(
    () => users.map((u) => ({ id: u.id, name: u.full_name || u.email || "" })).filter((u) => u.name !== ""),
    [users]
  );

  function notifyMentions(html: string, exclude: string[]) {
    if (!myId) return;
    const text = htmlToText(html, 10000);
    const rows = users
      .filter((u) => !exclude.includes(u.id))
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
    void supabase.from("notifications").insert(rows).then(() => undefined, () => undefined);
  }

  function appendLocal(m: Msg) {
    setThread((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    setConvs((cs) =>
      cs
        .map((c) => (c.id === m.conversation_id ? { ...c, last: m } : c))
        .sort((a, b) => (b.last?.created_at ?? b.created_at).localeCompare(a.last?.created_at ?? a.created_at))
    );
  }

  async function send(html: string) {
    if (!myId || !selected || selected === ANNOUNCEMENTS_ID) return;
    const { data } = await supabase
      .from("chat_messages")
      .insert({ conversation_id: selected, sender_id: myId, body: html })
      .select(MSG_COLUMNS)
      .single();
    if (!data) return;
    appendLocal(data as Msg);
    // members of a DM/group get the message itself; @mentions notify anyone else
    const conv = convs.find((c) => c.id === selected);
    notifyMentions(html, conv?.members.map((m) => m.user_id) ?? []);
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
    notifyMentions(html, []);
  }

  async function attach(file: File) {
    if (!myId || !selected || selected === ANNOUNCEMENTS_ID) return;
    if (file.size > 10 * 1024 * 1024) {
      await notifyDialog(t("attachTooLarge"));
      return;
    }
    const path = `${myId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const { error } = await supabase.storage.from("chat-uploads").upload(path, file);
    if (error) return;
    const { data } = await supabase
      .from("chat_messages")
      .insert({
        conversation_id: selected,
        sender_id: myId,
        body: `📎 ${file.name}`,
        attachment_path: path,
        attachment_name: file.name,
        attachment_type: file.type,
        attachment_size: file.size,
      })
      .select(MSG_COLUMNS)
      .single();
    if (data) appendLocal(data as Msg);
  }

  async function openDm(otherId: string) {
    const existing = convs.find((c) => c.kind === "dm" && c.members.some((m) => m.user_id === otherId));
    if (existing) {
      setSelected(existing.id);
      setShowPeople(false);
      return;
    }
    const { data, error } = await supabase.rpc("fn_chat_open_dm", { p_other: otherId });
    if (error || !data) {
      if (error) await notifyDialog(error.message, { tone: "danger" });
      return;
    }
    await loadSummaries();
    setSelected(data as string);
    setShowPeople(false);
  }

  function convTitle(c: Conversation): string {
    if (c.kind === "group") return c.name ?? "—";
    const other = c.members.find((m) => m.user_id !== myId);
    return displayName(other ? userById[other.user_id] : null);
  }
  function convAvatar(c: Conversation, size = "h-9 w-9") {
    if (c.kind === "group") {
      return (
        <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700", size)}>
          <Users2 size={16} />
        </span>
      );
    }
    const other = c.members.find((m) => m.user_id !== myId);
    const u = other ? userById[other.user_id] : null;
    if (u?.avatar_url) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={u.avatar_url} alt="" className={cn("shrink-0 rounded-full object-cover", size)} />;
    }
    return (
      <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700", size)}>
        {initialsOf(displayName(u))}
      </span>
    );
  }
  function senderName(id: string): string {
    if (id === myId) return myName ?? myEmail ?? t("youLabel");
    return displayName(userById[id]);
  }
  // DM read receipt: the other member has read past this message
  function readByOther(c: Conversation, m: Msg): boolean {
    const other = c.members.find((x) => x.user_id !== myId);
    return !!other?.last_read_at && other.last_read_at >= m.created_at;
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
        className={cn("flex items-center gap-2 text-sm", mine ? "text-white" : "text-slate-800", !url && "pointer-events-none opacity-60")}
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

  const selectedConv = selected && selected !== ANNOUNCEMENTS_ID ? convs.find((c) => c.id === selected) ?? null : null;
  const lastAnn = announcements.length > 0 ? announcements[announcements.length - 1] : null;
  const peopleWithoutDm = users.filter((u) => !convs.some((c) => c.kind === "dm" && c.members.some((m) => m.user_id === u.id)));
  // the creator or any admin can rename, add/remove members, or delete a group
  const canManage = (c: Conversation) => c.kind === "group" && (c.created_by === myId || myRole === "admin");
  const dayLabel = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    const y = new Date(today);
    y.setDate(today.getDate() - 1);
    const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    if (same(d, today)) return t("today");
    if (same(d, y)) return t("yesterday");
    return d.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
    });
  };
  const DaySep = ({ iso }: { iso: string }) => (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-slate-100" />
      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-500">{dayLabel(iso)}</span>
      <div className="h-px flex-1 bg-slate-100" />
    </div>
  );
  const smallAvatar = (id: string) => {
    const u = userById[id];
    if (u?.avatar_url) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={u.avatar_url} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />;
    }
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[9px] font-bold text-brand-700">
        {initialsOf(displayName(u))}
      </span>
    );
  };

  const bubble = (mine: boolean) =>
    cn(
      "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:list-decimal [&_ol]:ps-5",
      mine ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800"
    );

  return (
    <div>
      <PageHeader
        title={t("inbox")}
        subtitle={t("inboxSubtitle")}
        actions={
          <button type="button" onClick={() => setGroupModal({ mode: "create" })} className="btn-primary flex items-center gap-1.5">
            <Plus size={16} />
            {t("newGroup")}
          </button>
        }
      />

      <div className="card flex h-[calc(100vh-12rem)] overflow-hidden p-0">
        {/* Conversation list */}
        <div className={cn("w-full shrink-0 flex-col border-e border-slate-200 sm:flex sm:w-72", selected ? "hidden" : "flex")}>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("conversations")}</span>
            <button
              type="button"
              onClick={() => setShowPeople((v) => !v)}
              className={cn("rounded-md p-1 text-slate-500 hover:bg-slate-100", showPeople && "bg-brand-50 text-brand-700")}
              title={t("startChatWith")}
            >
              <Plus size={16} />
            </button>
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
                  <span className="truncate text-sm font-semibold text-slate-800">{t("announcementsLbl")}</span>
                  {lastAnn && (
                    <span dir="ltr" className="shrink-0 text-[10px] text-slate-400">
                      {formatDateTime(lastAnn.created_at)}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-slate-500" dir="auto">
                    {lastAnn ? `${senderName(lastAnn.sender_id)}: ${htmlToText(lastAnn.body, 60)}` : t("noMessages")}
                  </span>
                  {annUnread > 0 && (
                    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">
                      {annUnread}
                    </span>
                  )}
                </span>
              </span>
            </button>

            {/* People picker to start a DM */}
            {showPeople && (
              <div className="border-b border-slate-100 bg-slate-50/60">
                <div className="px-4 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t("startChatWith")}</div>
                {peopleWithoutDm.length === 0 ? (
                  <div className="px-4 py-2 text-xs text-slate-400">—</div>
                ) : (
                  peopleWithoutDm.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => openDm(u.id)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-start hover:bg-white"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-700">
                        {initialsOf(displayName(u))}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-slate-800">{displayName(u)}</span>
                        <span className="block truncate text-[11px] text-slate-400" dir="ltr">
                          {u.email}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}

            {listLoading ? (
              <Spinner />
            ) : convs.length === 0 && !showPeople ? (
              <button
                type="button"
                onClick={() => setShowPeople(true)}
                className="block w-full px-4 py-6 text-center text-sm text-slate-400 hover:text-brand-700"
              >
                {t("startChatWith")}
              </button>
            ) : (
              convs.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelected(c.id)}
                  className={cn("flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-slate-50", selected === c.id && "bg-brand-50")}
                >
                  {convAvatar(c)}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-slate-800">{convTitle(c)}</span>
                      {c.last && (
                        <span dir="ltr" className="shrink-0 text-[10px] text-slate-400">
                          {formatDateTime(c.last.created_at)}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-500" dir="auto">
                        {c.last
                          ? `${c.last.sender_id === myId ? t("sentLabel") : c.kind === "group" ? `${senderName(c.last.sender_id)}:` : ""} ${htmlToText(c.last.body, 60)}`
                          : c.kind === "group"
                            ? t("membersCount").replace("{n}", String(c.members.length))
                            : t("noMessages")}
                      </span>
                      {c.unread > 0 && (
                        <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">
                          {c.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Thread */}
        <div className={cn("min-w-0 flex-1 flex-col sm:flex", selected ? "flex" : "hidden")}>
          {selected === ANNOUNCEMENTS_ID ? (
            <>
              <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
                <button type="button" className="rounded-md p-1 text-slate-500 hover:bg-slate-100 sm:hidden" onClick={() => setSelected(null)}>
                  <ArrowLeft size={18} className="rtl:-scale-x-100" />
                </button>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-white">
                  <Megaphone size={16} />
                </span>
                <div className="truncate text-sm font-bold text-slate-800">{t("announcementsLbl")}</div>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {annLoading ? (
                  <Spinner />
                ) : announcements.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">{t("noMessages")}</div>
                ) : (
                  announcements.map((a, i) => {
                    const mine = a.sender_id === myId;
                    const prev = announcements[i - 1];
                    const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(a.created_at).toDateString();
                    return (
                      <div key={a.id}>
                        {newDay && <DaySep iso={a.created_at} />}
                        <div className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
                        {!mine && <div className={cn("mb-0.5 text-[11px] font-semibold", nameColor(a.sender_id))}>{senderName(a.sender_id)}</div>}
                        <div dir="auto" className={bubble(mine)} dangerouslySetInnerHTML={{ __html: sanitizeHtml(a.body) }} />
                        <div className="mt-0.5 text-[10px] text-slate-400" dir="ltr">
                          {formatDateTime(a.created_at)}
                        </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>
              <div className="border-t border-slate-100 p-3">
                <RichComposer onSend={sendAnnouncement} placeholder={t("typeMessage")} disabled={!myId} mentionUsers={mentionUsers} />
              </div>
            </>
          ) : !selectedConv ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400">
              <MessageSquare size={40} strokeWidth={1.5} />
              <p className="text-sm">{t("selectConversation")}</p>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
                <button type="button" className="rounded-md p-1 text-slate-500 hover:bg-slate-100 sm:hidden" onClick={() => setSelected(null)}>
                  <ArrowLeft size={18} className="rtl:-scale-x-100" />
                </button>
                {convAvatar(selectedConv)}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-slate-800">{convTitle(selectedConv)}</div>
                  <div className="truncate text-xs text-slate-400" dir="auto">
                    {selectedConv.kind === "group"
                      ? `${t("membersCount").replace("{n}", String(selectedConv.members.length))} — ${selectedConv.members.map((m) => senderName(m.user_id)).join(" · ")}`
                      : userById[selectedConv.members.find((m) => m.user_id !== myId)?.user_id ?? ""]?.email}
                  </div>
                </div>
                {canManage(selectedConv) && (
                  <button
                    type="button"
                    onClick={() => setGroupModal({ mode: "edit", conv: selectedConv })}
                    className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
                    title={t("manageMembers")}
                  >
                    <Settings2 size={16} />
                  </button>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {threadLoading ? (
                  <Spinner />
                ) : thread.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">{t("noMessages")}</div>
                ) : (
                  thread.map((m, i) => {
                    const mine = m.sender_id === myId;
                    const prev = thread[i - 1];
                    const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
                    const sameSender = !!prev && !newDay && prev.sender_id === m.sender_id;
                    const isGroup = selectedConv.kind === "group";
                    return (
                      <div key={m.id}>
                        {newDay && <DaySep iso={m.created_at} />}
                        <div className={cn("flex gap-2", mine ? "flex-row-reverse" : "flex-row", sameSender ? "mt-0.5" : "mt-2")}>
                          {!mine && isGroup && <div className="w-6 shrink-0 self-end">{smallAvatar(m.sender_id)}</div>}
                          <div className={cn("flex min-w-0 flex-col", mine ? "items-end" : "items-start")}>
                        {!mine && isGroup && !sameSender && (
                          <div className={cn("mb-0.5 text-[11px] font-semibold", nameColor(m.sender_id))}>{senderName(m.sender_id)}</div>
                        )}
                        {m.attachment_path ? (
                          <div className={cn("max-w-[75%] rounded-2xl px-3.5 py-2 text-sm", mine ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800")}>
                            {renderAttachment(m)}
                          </div>
                        ) : (
                          <div dir="auto" className={bubble(mine)} dangerouslySetInnerHTML={{ __html: sanitizeHtml(m.body) }} />
                        )}
                        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
                          <span dir="ltr">{formatDateTime(m.created_at)}</span>
                          {mine && selectedConv.kind === "dm" && (
                            <CheckCheck size={13} className={readByOther(selectedConv, m) ? "text-sky-500" : "text-slate-400"} />
                          )}
                        </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              <div className="border-t border-slate-100 p-3">
                <RichComposer onSend={send} placeholder={t("typeMessage")} disabled={!myId} mentionUsers={mentionUsers} onAttach={attach} />
              </div>
            </>
          )}
        </div>
      </div>

      {groupModal && (
        <GroupModal
          mode={groupModal.mode}
          conv={groupModal.mode === "edit" ? groupModal.conv : null}
          users={users}
          lang={lang}
          onClose={() => setGroupModal(null)}
          onDone={async (id) => {
            setGroupModal(null);
            await loadSummaries();
            setSelected(id || null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- group modal
function GroupModal({
  mode,
  conv,
  users,
  onClose,
  onDone,
}: {
  mode: "create" | "edit";
  conv: Conversation | null;
  users: DirUser[];
  lang: "ar" | "en";
  onClose: () => void;
  onDone: (id: string) => void | Promise<void>;
}) {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [name, setName] = useState(conv?.name ?? "");
  const [deleting, setDeleting] = useState(false);
  const [picked, setPicked] = useState<string[]>(
    conv ? conv.members.map((m) => m.user_id).filter((id) => users.some((u) => u.id === id)) : []
  );
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const visible = users.filter((u) => {
    const s = q.trim().toLowerCase();
    return !s || (u.full_name ?? "").toLowerCase().includes(s) || (u.email ?? "").toLowerCase().includes(s);
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (mode === "create" && !name.trim()) return setError(t("groupName"));
    if (picked.length === 0) return setError(t("pickMembersHint"));
    setSaving(true);
    if (mode === "create") {
      const { data, error: err } = await supabase.rpc("fn_chat_create_group", { p_name: name.trim(), p_members: picked });
      setSaving(false);
      if (err || !data) return setError(err?.message ?? "Failed");
      await onDone(data as string);
    } else if (conv) {
      const { error: err } = await supabase.rpc("fn_chat_update_group", { p_conv: conv.id, p_name: name.trim() || null, p_members: picked });
      setSaving(false);
      if (err) return setError(err.message);
      await onDone(conv.id);
    }
  }

  async function removeGroup() {
    if (!conv) return;
    const ok = await confirmDialog(t("deleteGroupConfirm").replace("{name}", conv.name ?? ""), { tone: "danger", okLabel: t("delete") });
    if (!ok) return;
    setDeleting(true);
    const { error: err } = await supabase.rpc("fn_chat_delete_group", { p_conv: conv.id });
    setDeleting(false);
    if (err) return setError(err.message);
    await onDone("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-900/5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <Users2 size={18} className="text-violet-600" />
            {mode === "create" ? t("newGroup") : t("manageMembers")}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-sm font-semibold text-slate-700">{t("groupName")}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus={mode === "create"} maxLength={80} />
        </div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-semibold text-slate-700">
            {t("groupMembers")} <span className="text-xs font-normal text-slate-400">({picked.length})</span>
          </label>
          <div className="flex items-center gap-2 text-xs">
            <button type="button" onClick={() => setPicked(users.map((u) => u.id))} className="font-semibold text-brand-700 hover:underline">
              {t("selectAll")}
            </button>
            <button type="button" onClick={() => setPicked([])} className="font-semibold text-slate-500 hover:underline">
              {t("unselectAll")}
            </button>
          </div>
        </div>
        <p className="mb-2 text-[11px] text-slate-400">{t("pickMembersHint")}</p>
        <input className="input mb-2" placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
          {visible.map((u) => (
            <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-600"
                checked={picked.includes(u.id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, u.id] : p.filter((x) => x !== u.id)))}
              />
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-700">
                {initialsOf(displayName(u))}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{displayName(u)}</span>
                <span className="block truncate text-[11px] text-slate-400" dir="ltr">
                  {u.email}
                </span>
              </span>
            </label>
          ))}
        </div>
        {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="mt-4 flex items-center justify-end gap-2">
          {mode === "edit" && (
            <button type="button" onClick={removeGroup} disabled={deleting} className="me-auto text-sm font-semibold text-red-600 hover:underline">
              {t("deleteGroup")}
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            {t("cancel")}
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? t("saving") : mode === "create" ? t("createGroup") : t("saveMembers")}
          </button>
        </div>
      </form>
    </div>
  );
}
