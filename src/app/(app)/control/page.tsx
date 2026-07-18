"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Download,
  MonitorSmartphone,
  RotateCcw,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { PageHeader, Spinner, EmptyState } from "@/components/ui";
import { SearchBox } from "@/components/search-box";
import { formatDateTime, formatNumber, toCsv, downloadCsv, cn, sanitizeSearch } from "@/lib/utils";

const PAGE_SIZE = 50;

type TabKey = "activity" | "sessions" | "trash";

interface ActivityRow {
  id: number;
  user_id: string | null;
  user_email: string | null;
  kind: "visit" | "click" | "action";
  page: string | null;
  label: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

interface DirectoryUser {
  id: string;
  full_name: string | null;
  email: string;
  role: string | null;
  avatar_url: string | null;
}

interface SessionRow {
  session_id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
  updated_at: string | null;
  user_agent: string | null;
  ip: string | null;
}

interface TrashRow {
  id: number;
  table_name: string;
  label: string | null;
  payload: Record<string, unknown> | null;
  extra: Record<string, unknown> | null;
  deleted_by: string | null;
  deleted_by_email: string | null;
  deleted_at: string;
}

const KIND_LABELS: Record<ActivityRow["kind"], DictKey> = {
  visit: "visitKind",
  click: "clickKind",
  action: "actionKind",
};

const KIND_COLORS: Record<ActivityRow["kind"], string> = {
  visit: "bg-sky-100 text-sky-700",
  click: "bg-slate-100 text-slate-600",
  action: "bg-amber-100 text-amber-800",
};

const SECTION_LABELS: Record<string, DictKey> = {
  campaigns: "sectionCampaigns",
  purchase_orders: "sectionPurchaseOrders",
  team_contacts: "sectionTeamContacts",
  stock_move_lists: "sectionStockLists",
  flipbooks: "sectionFlipbooks",
};

const PERIODS = [
  { key: "24h", hours: 24 },
  { key: "7d", hours: 24 * 7 },
  { key: "30d", hours: 24 * 30 },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];

function periodFromIso(period: PeriodKey): string {
  const hours = PERIODS.find((p) => p.key === period)?.hours ?? 24 * 30;
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

// Tiny local user-agent summary: enough to tell devices apart, no library needed.
// Edg/ must be checked before Chrome, Chrome before Safari (UA string quirks).
function deviceSummary(ua: string | null): string {
  if (!ua) return "—";
  const os = /Windows/i.test(ua)
    ? "Windows"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iPhone"
      : /Macintosh|Mac OS X/i.test(ua)
        ? "Mac"
        : /Android/i.test(ua)
          ? "Android"
          : /Linux/i.test(ua)
            ? "Linux"
            : "";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /Chrome\//i.test(ua)
      ? "Chrome"
      : /Firefox\//i.test(ua)
        ? "Firefox"
        : /Safari\//i.test(ua)
          ? "Safari"
          : "";
  const parts = [browser, os].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

const dangerBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed";

export default function ControlCenterPage() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [ownerState, setOwnerState] = useState<"checking" | "owner" | "denied">("checking");
  const [tab, setTab] = useState<TabKey>("activity");

  // UI-level owner gate (data itself is guarded server-side by RLS / RPCs)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        if (!cancelled) setOwnerState("denied");
        return;
      }
      const { data } = await supabase.from("profiles").select("is_owner").eq("id", uid).single();
      if (cancelled) return;
      const isOwner = (data as { is_owner: boolean } | null)?.is_owner === true;
      setOwnerState(isOwner ? "owner" : "denied");
      // fire-and-forget 30-day retention sweep
      if (isOwner) supabase.rpc("purge_old_activity").then(() => undefined, () => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const tabs: { key: TabKey; label: DictKey; icon: React.ReactNode }[] = [
    { key: "activity", label: "activityTab", icon: <Activity size={14} /> },
    { key: "sessions", label: "sessionsTab", icon: <MonitorSmartphone size={14} /> },
    { key: "trash", label: "trashTab", icon: <Trash2 size={14} /> },
  ];

  if (ownerState === "checking") {
    return (
      <div>
        <PageHeader title={t("controlCenter")} subtitle={t("controlSubtitle")} />
        <Spinner />
      </div>
    );
  }

  if (ownerState === "denied") {
    return (
      <div>
        <PageHeader title={t("controlCenter")} subtitle={t("controlSubtitle")} />
        <EmptyState message={t("error")} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t("controlCenter")}
        subtitle={t("controlSubtitle")}
        actions={<ShieldCheck size={20} className="text-emerald-600" />}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map(({ key, label, icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
              tab === key
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-slate-200 text-slate-500 hover:border-slate-300"
            )}
          >
            {icon}
            {t(label)}
          </button>
        ))}
      </div>

      {tab === "activity" && <ActivityTab />}
      {tab === "sessions" && <SessionsTab />}
      {tab === "trash" && <TrashTab />}
    </div>
  );
}

// ---- Tab 1: Activity log -------------------------------------------

function ActivityTab() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [userId, setUserId] = useState("");
  const [kind, setKind] = useState("");
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("fn_user_directory").then(({ data }) => {
      if (!cancelled) setUsers((data as DirectoryUser[]) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const buildQuery = useCallback(
    (withCount: boolean) => {
      let query = withCount
        ? supabase.from("user_activity").select("*", { count: "exact" })
        : supabase.from("user_activity").select("*");
      query = query.gte("created_at", periodFromIso(period));
      if (userId) query = query.eq("user_id", userId);
      if (kind) query = query.eq("kind", kind);
      if (search) {
        const s = sanitizeSearch(search);
        if (s) {
          query = query.or(`page.ilike.%${s}%,label.ilike.%${s}%,user_email.ilike.%${s}%`);
        }
      }
      return query;
    },
    [supabase, period, userId, kind, search]
  );

  // guarded against overlapping fetches like the orders page: a slow stale
  // response must never overwrite the rows of a newer filter selection
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, count } = await buildQuery(true)
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (cancelled) return;
      setRows((data as ActivityRow[]) ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [buildQuery, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function exportReport() {
    setExporting(true);
    const { data } = await buildQuery(false)
      .order("created_at", { ascending: false })
      .range(0, 9999);
    const list = (data as ActivityRow[]) ?? [];
    const csvRows = list.map((r) => ({
      time: formatDateTime(r.created_at),
      user: r.user_email ?? "",
      kind: r.kind,
      page: r.page ?? "",
      label: r.label ?? "",
      detail: r.detail ? JSON.stringify(r.detail) : "",
    }));
    downloadCsv(
      `user-activity-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(csvRows, ["time", "user", "kind", "page", "label", "detail"])
    );
    setExporting(false);
  }

  return (
    <div>
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input w-auto min-w-40"
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              setPage(0);
            }}
          >
            <option value="">{t("allUsers")}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </select>
          <select
            className="input w-auto min-w-32"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(0);
            }}
          >
            <option value="">{t("allKinds")}</option>
            <option value="visit">{t("visitKind")}</option>
            <option value="click">{t("clickKind")}</option>
            <option value="action">{t("actionKind")}</option>
          </select>
          <div className="flex gap-1">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  setPeriod(p.key);
                  setPage(0);
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                  period === p.key
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-slate-200 text-slate-500 hover:border-slate-300"
                )}
              >
                <span dir="ltr">{p.key}</span>
              </button>
            ))}
          </div>
          <SearchBox
            className="flex-1 min-w-52"
            placeholder={t("searchActivity")}
            value={searchInput}
            onChange={setSearchInput}
            onCommit={(v) => {
              setPage(0);
              setSearch(v);
            }}
            active={!!search}
          />
          <button className="btn-primary" onClick={exportReport} disabled={exporting || loading}>
            <Download size={16} />
            {t("downloadReport")}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">{t("retentionNote")}</p>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-500">{t("noActivity")}</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>{t("activityTime")}</th>
                <th>{t("activityUser")}</th>
                <th>{t("activityKind")}</th>
                <th>{t("activityPage")}</th>
                <th>{t("activityLabel")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="text-xs text-slate-500" dir="ltr">
                    {formatDateTime(r.created_at)}
                  </td>
                  <td dir="ltr">{r.user_email ?? "—"}</td>
                  <td>
                    <span
                      className={cn(
                        "inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
                        KIND_COLORS[r.kind] ?? "bg-slate-100 text-slate-600"
                      )}
                    >
                      {t(KIND_LABELS[r.kind] ?? "allKinds")}
                    </span>
                  </td>
                  <td className="font-mono text-xs text-slate-600" dir="ltr">
                    {r.page ?? "—"}
                  </td>
                  <td className="!whitespace-normal max-w-md">
                    <span className="line-clamp-1">{r.label ?? "—"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
        <span>
          {t("page")} {page + 1} {t("of")} {formatNumber(totalPages)}
        </span>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
            {t("previous")}
          </button>
          <button
            className="btn-secondary"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            {t("next")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Tab 2: Sessions & devices -------------------------------------

function SessionsTab() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("owner_list_sessions");
    setSessions((data as SessionRow[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, SessionRow[]>();
    for (const s of sessions) {
      const list = map.get(s.user_id);
      if (list) list.push(s);
      else map.set(s.user_id, [s]);
    }
    return Array.from(map.values());
  }, [sessions]);

  async function terminateOne(sessionId: string) {
    if (!confirm(t("terminateConfirm"))) return;
    setBusy(true);
    await supabase.rpc("owner_terminate_session", { p_session_id: sessionId });
    await load();
    setBusy(false);
  }

  async function terminateAll(uid: string) {
    if (!confirm(t("terminateConfirm"))) return;
    setBusy(true);
    await supabase.rpc("owner_terminate_user_sessions", { p_user_id: uid });
    await load();
    setBusy(false);
  }

  if (loading) return <Spinner />;
  if (groups.length === 0) return <EmptyState message={t("noSessions")} />;

  return (
    <div className="space-y-4">
      {groups.map((list) => {
        const first = list[0];
        return (
          <div key={first.user_id} className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div>
                <div className="text-sm font-bold text-slate-900">
                  {first.full_name ?? first.email ?? "—"}
                  <span className="ms-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                    {formatNumber(list.length)}
                  </span>
                </div>
                <div className="text-xs text-slate-500" dir="ltr">
                  {first.email ?? ""}
                </div>
              </div>
              <button className={dangerBtn} disabled={busy} onClick={() => terminateAll(first.user_id)}>
                <XCircle size={14} />
                {t("terminateAll")}
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {list.map((s) => (
                <div key={s.session_id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
                  <div className="min-w-40">
                    <div className="text-[11px] font-semibold uppercase text-slate-400">{t("device")}</div>
                    <div className="font-semibold text-slate-800 inline-flex items-center gap-1.5">
                      <MonitorSmartphone size={14} className="text-slate-400" />
                      <span dir="ltr">{deviceSummary(s.user_agent)}</span>
                    </div>
                  </div>
                  <div className="min-w-32">
                    <div className="text-[11px] font-semibold uppercase text-slate-400">{t("ipAddress")}</div>
                    <div className="text-slate-600" dir="ltr">
                      {s.ip ?? "—"}
                    </div>
                  </div>
                  <div className="min-w-36">
                    <div className="text-[11px] font-semibold uppercase text-slate-400">{t("signedInAt")}</div>
                    <div className="text-slate-600 text-xs" dir="ltr">
                      {formatDateTime(s.created_at)}
                    </div>
                  </div>
                  <div className="min-w-36">
                    <div className="text-[11px] font-semibold uppercase text-slate-400">{t("lastSeen")}</div>
                    <div className="text-slate-600 text-xs" dir="ltr">
                      {formatDateTime(s.updated_at)}
                    </div>
                  </div>
                  <div className="ms-auto">
                    <button className={dangerBtn} disabled={busy} onClick={() => terminateOne(s.session_id)}>
                      {t("terminate")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Tab 3: Trash ---------------------------------------------------

function TrashTab() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<TrashRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("trash").select("*").order("deleted_at", { ascending: false });
    setRows((data as TrashRow[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  function flipbookPath(row: TrashRow): string {
    const p = row.payload?.path;
    return typeof p === "string" ? p : "";
  }

  async function restore(row: TrashRow) {
    setBusyId(row.id);
    setError("");
    // Flipbook files live in storage: move the file back out of trash/ first,
    // then restore the database row snapshot.
    if (row.table_name === "flipbooks") {
      const path = flipbookPath(row);
      if (path) {
        const { error: moveErr } = await supabase.storage.from("flipbooks").move(`trash/${path}`, path);
        if (moveErr) {
          setError(moveErr.message);
          setBusyId(null);
          return;
        }
      }
    }
    const { error: err } = await supabase.rpc("trash_restore", { p_id: row.id });
    if (err) setError(err.message);
    await load();
    setBusyId(null);
  }

  async function deleteForever(row: TrashRow) {
    if (!confirm(t("deleteForeverConfirm"))) return;
    setBusyId(row.id);
    setError("");
    if (row.table_name === "flipbooks") {
      const path = flipbookPath(row);
      if (path) {
        // A v2 book parks only its manifest in trash/ — its page images stay
        // under {id}/ and are only removed here, at purge time.
        if (path.endsWith(".json")) {
          const id = path.slice(0, -".json".length);
          const { data: pages } = await supabase.storage.from("flipbooks").list(id, { limit: 1000 });
          if (pages && pages.length > 0) {
            await supabase.storage.from("flipbooks").remove(pages.map((f) => `${id}/${f.name}`));
          }
        }
        await supabase.storage.from("flipbooks").remove([`trash/${path}`]);
      }
    }
    const { error: err } = await supabase.from("trash").delete().eq("id", row.id);
    if (err) setError(err.message);
    await load();
    setBusyId(null);
  }

  if (loading) return <Spinner />;

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{error}</div>
      )}
      {rows.length === 0 ? (
        <EmptyState message={t("trashEmpty")} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t("deletedItem")}</th>
                <th>{t("deletedFrom")}</th>
                <th>{t("deletedBy")}</th>
                <th>{t("deletedAt")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sectionKey = SECTION_LABELS[r.table_name];
                return (
                  <tr key={r.id}>
                    <td className="font-semibold !whitespace-normal max-w-md">{r.label ?? "—"}</td>
                    <td>
                      <span className="inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                        {sectionKey ? t(sectionKey) : r.table_name}
                      </span>
                    </td>
                    <td dir="ltr" className="text-xs text-slate-500">
                      {r.deleted_by_email ?? "—"}
                    </td>
                    <td className="text-xs text-slate-500" dir="ltr">
                      {formatDateTime(r.deleted_at)}
                    </td>
                    <td>
                      <div className="flex justify-end gap-2">
                        <button
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={busyId !== null}
                          onClick={() => restore(r)}
                        >
                          <RotateCcw size={14} />
                          {t("restore")}
                        </button>
                        <button className={dangerBtn} disabled={busyId !== null} onClick={() => deleteForever(r)}>
                          <Trash2 size={14} />
                          {t("deleteForever")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
