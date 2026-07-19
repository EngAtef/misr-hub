"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, MessageSquare, X, CheckCheck, Megaphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { sanitizeHtml } from "@/lib/rich-text";
import { RichComposer } from "@/components/rich-composer";
import { MultiSelect } from "@/components/multi-select";
import { formatDateTime, cn } from "@/lib/utils";
import type { Profile } from "@/lib/types";

interface Notification {
  id: number;
  sender_email: string | null;
  title: string | null;
  body: string;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

interface DirectoryUser {
  id: string;
  full_name: string | null;
  email: string;
}

/** Sidebar bell + inbox icons with unread badges, notification panel and sender. */
export function NotificationBell({ profile }: { profile: Profile }) {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [counts, setCounts] = useState({ messages: 0, notifications: 0 });
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [composeOpen, setComposeOpen] = useState(false);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [sending, setSending] = useState(false);

  const refreshCounts = useCallback(async () => {
    // enforcement hook for the owner's "terminate session": when this device's
    // session has been deleted server-side, sign out right away instead of
    // riding the access token until it expires
    const { data: alive, error: aliveErr } = await supabase.rpc("fn_session_alive");
    if (!aliveErr && alive === false) {
      await supabase.auth.signOut();
      window.location.href = "/login";
      return;
    }
    const { data } = await supabase.rpc("fn_unread_counts");
    if (data) setCounts({ messages: Number(data.messages ?? 0), notifications: Number(data.notifications ?? 0) });
  }, [supabase]);

  useEffect(() => {
    refreshCounts();
    const timer = setInterval(refreshCounts, 20000);
    const onFocus = () => refreshCounts();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshCounts]);

  async function openPanel() {
    setOpen(true);
    const { data } = await supabase
      .from("notifications")
      .select("id, sender_email, title, body, link, created_at, read_at")
      .eq("recipient_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(30);
    setItems((data as Notification[]) ?? []);
  }

  async function markAllRead() {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", profile.id)
      .is("read_at", null);
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    refreshCounts();
  }

  async function markRead(id: number) {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .is("read_at", null);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    refreshCounts();
  }

  async function openCompose() {
    setComposeOpen(true);
    if (!directory.length) {
      const { data } = await supabase.rpc("fn_user_directory");
      setDirectory(((data as DirectoryUser[]) ?? []).filter((u) => u.id !== profile.id));
    }
  }

  async function sendNotification(body: string) {
    const targets = recipients.length ? directory.filter((u) => recipients.includes(u.email)) : directory;
    if (!targets.length || sending) return;
    setSending(true);
    await supabase.from("notifications").insert(
      targets.map((u) => ({
        recipient_id: u.id,
        sender_id: profile.id,
        sender_email: profile.email,
        title: title.trim() || null,
        body,
      }))
    );
    setSending(false);
    setComposeOpen(false);
    setTitle("");
    setRecipients([]);
  }

  const badge = (n: number) =>
    n > 0 && (
      <span className="absolute -top-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
        {n > 99 ? "99+" : n}
      </span>
    );

  return (
    <>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          aria-label={t("notifications")}
          className="relative rounded-lg border border-brand-800 bg-brand-900 p-2 text-brand-200 hover:text-white"
          onClick={openPanel}
        >
          <Bell size={16} />
          {badge(counts.notifications)}
        </button>
        <Link
          href="/inbox"
          aria-label={t("inbox")}
          className="relative rounded-lg border border-brand-800 bg-brand-900 p-2 text-brand-200 hover:text-white"
        >
          <MessageSquare size={16} />
          {badge(counts.messages)}
        </Link>
      </div>

      {open && (
        <div className="fixed inset-0 z-50" dir={lang === "ar" ? "rtl" : "ltr"}>
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="absolute top-4 start-4 end-4 sm:start-6 sm:end-auto sm:w-[26rem] max-h-[85vh] overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h3 className="font-bold text-slate-800">{t("notifications")}</h3>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title={t("sendNotification")}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                  onClick={openCompose}
                >
                  <Megaphone size={16} />
                </button>
                <button
                  type="button"
                  title={t("markAllRead")}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                  onClick={markAllRead}
                >
                  <CheckCheck size={16} />
                </button>
                <button type="button" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => setOpen(false)}>
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-slate-400">{t("noNotifications")}</div>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className={cn(
                      "block w-full border-b border-slate-50 px-4 py-3 text-start hover:bg-slate-50",
                      !n.read_at && "bg-brand-50/50"
                    )}
                    onClick={() => markRead(n.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-800">
                        {n.title || n.sender_email || t("notifications")}
                      </span>
                      {!n.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                    </div>
                    <div
                      className="mt-0.5 text-sm text-slate-600 [&_ul]:list-disc [&_ul]:ps-5"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(n.body) }}
                    />
                    <div className="mt-1 text-[11px] text-slate-400" dir="ltr">
                      {n.sender_email ? `${n.sender_email} · ` : ""}
                      {formatDateTime(n.created_at)}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {composeOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" dir={lang === "ar" ? "rtl" : "ltr"}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setComposeOpen(false)} />
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold text-slate-800">{t("sendNotification")}</h3>
              <button type="button" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => setComposeOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <MultiSelect
                options={directory.map((u) => u.email)}
                values={recipients}
                onChange={setRecipients}
                placeholder={t("everyone")}
              />
              <input
                className="input"
                placeholder={t("notificationTitle")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <RichComposer onSend={sendNotification} placeholder={t("typeMessage")} sendOnEnter={false} disabled={sending} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
