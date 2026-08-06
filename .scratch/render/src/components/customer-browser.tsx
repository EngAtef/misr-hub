"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, SlidersHorizontal, Users2, Merge, RefreshCw, X } from "lucide-react";
import { createClient } from "../lib/supabase/client";
import { useLang } from "../lib/i18n";
import { Spinner, SortTh } from "../components/ui";
import { MultiSelect } from "../components/multi-select";
import { SearchBox } from "../components/search-box";
import { ContactActions } from "../components/contact-actions";
import { formatMoney, formatNumber, formatDate, toCsv, downloadCsv, cn } from "../lib/utils";
import { useMyRole } from "../lib/use-role";
import type { Identity } from "../components/customer-drawer";

const SEGMENTS = ["champions", "loyal", "new", "promising", "at_risk", "hibernating"];
const STATUSES = ["all", "buyers", "repeat", "one_time", "never"] as const;
type Status = (typeof STATUSES)[number];

interface Filters {
  search: string;
  segments: string[];
  cities: string[];
  states: string[];
  status: Status;
  minOrders: string;
  maxOrders: string;
  minSpent: string;
  maxSpent: string;
  lastFrom: string;
  lastTo: string;
  joinedFrom: string;
  joinedTo: string;
  birthMonth: string;
  hasEmail: boolean;
  hasPhone: boolean;
  mergedOnly: boolean;
  activeOnly: boolean;
}

const EMPTY: Filters = {
  search: "", segments: [], cities: [], states: [], status: "all",
  minOrders: "", maxOrders: "", minSpent: "", maxSpent: "",
  lastFrom: "", lastTo: "", joinedFrom: "", joinedTo: "", birthMonth: "",
  hasEmail: false, hasPhone: false, mergedOnly: false, activeOnly: false,
};

const num = (v: string) => (v.trim() === "" ? null : Number(v));
const str = (v: string) => (v.trim() === "" ? null : v.trim());

/**
 * One row per PERSON (identity), not per platform account. Search hits
 * every phone/email/address/account id of the merged person, so looking
 * up a guest order's phone finds the whole history.
 */
export function CustomerBrowser({
  onOpenCustomer,
  onChanged,
}: {
  onOpenCustomer: (id: string) => void;
  onChanged?: () => void;
}) {
  const { t, lang } = useLang();
  const role = useMyRole();
  const canEdit = role === "admin" || role === "manager";
  const supabase = useMemo(() => createClient(), []);

  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [searchInput, setSearchInput] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rows, setRows] = useState<Identity[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "spent", dir: "desc" });
  const [options, setOptions] = useState<{ cities: string[]; states: string[] }>({ cities: [], states: [] });
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const params = useCallback(
    (limit: number, offset: number) => ({
      p_search: str(filters.search),
      p_segments: filters.segments.length ? filters.segments : null,
      p_cities: filters.cities.length ? filters.cities : null,
      p_states: filters.states.length ? filters.states : null,
      p_status: filters.status === "all" ? null : filters.status,
      p_min_orders: num(filters.minOrders),
      p_max_orders: num(filters.maxOrders),
      p_min_spent: num(filters.minSpent),
      p_max_spent: num(filters.maxSpent),
      p_last_from: str(filters.lastFrom),
      p_last_to: str(filters.lastTo),
      p_joined_from: str(filters.joinedFrom),
      p_joined_to: str(filters.joinedTo),
      p_birth_month: num(filters.birthMonth),
      p_has_email: filters.hasEmail ? true : null,
      p_has_phone: filters.hasPhone ? true : null,
      p_merged_only: filters.mergedOnly,
      p_active: filters.activeOnly ? true : null,
      p_sort: sort.key,
      p_dir: sort.dir,
      p_limit: limit,
      p_offset: offset,
    }),
    [filters, sort]
  );

  useEffect(() => {
    supabase.rpc("fn_identity_filter_options").then(({ data }) => {
      const o = data as { cities: string[]; states: string[] } | null;
      setOptions({ cities: o?.cities ?? [], states: o?.states ?? [] });
    });
  }, [supabase]);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("fn_identities_list", params(pageSize, page * pageSize));
    if (!error) {
      const payload = data as { total: number; rows: Identity[] } | null;
      setRows(payload?.rows ?? []);
      setTotal(payload?.total ?? 0);
    }
    setLoading(false);
  }, [supabase, params, page, pageSize]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await reload();
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  function patch(p: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...p }));
    setPage(0);
    setSelected([]);
  }

  function toggleSort(key: string) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
    setPage(0);
  }

  async function exportAll() {
    setExporting(true);
    const { data } = await supabase.rpc("fn_identities_list", params(20000, 0));
    const payload = data as { rows: Identity[] } | null;
    const list = (payload?.rows ?? []).map((r) => ({
      person_id: r.master_id,
      accounts: r.accounts,
      account_ids: (r.account_ids ?? []).join(" | "),
      name: r.name,
      phone: r.phone,
      all_phones: (r.phones ?? []).join(" | "),
      email: r.email,
      all_emails: (r.emails ?? []).join(" | "),
      city: r.city,
      area: r.area,
      segment: r.segment,
      lifetime_orders: r.lifetime_orders,
      lifetime_delivered: r.lifetime_delivered,
      lifetime_canceled: r.lifetime_canceled,
      lifetime_amount: r.lifetime_amount,
      lifetime_delivered_amount: r.lifetime_delivered_amount,
      last_order_at: r.last_order_at,
      last_order_state: r.last_order_state,
      registered_at: r.first_joined_at,
      birthdate: r.birthdate,
      recency_days: r.recency_days,
    }));
    if (list.length) {
      downloadCsv(`customers-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(list as unknown as Record<string, unknown>[]));
    }
    setExporting(false);
  }

  async function mergeSelected() {
    if (selected.length < 2) return;
    const picked = rows.filter((r) => selected.includes(r.master_id));
    // survivor = the person registered first
    const survivor = [...picked].sort((a, b) =>
      (a.first_joined_at ?? "9999").localeCompare(b.first_joined_at ?? "9999")
    )[0];
    const ids = picked.flatMap((r) => r.account_ids ?? [r.master_id]);
    if (!confirm(t("mergeConfirm").replace("{n}", String(picked.length)).replace("{name}", survivor.name ?? survivor.master_id))) return;
    setBusy(true);
    const { error } = await supabase.rpc("fn_merge_customers", { p_ids: ids, p_master: survivor.master_id });
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    setSelected([]);
    await reload();
    onChanged?.();
  }

  async function rebuild() {
    setBusy(true);
    const { error } = await supabase.rpc("fn_rebuild_customer_identities");
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    await reload();
    onChanged?.();
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const activeFilterCount =
    (filters.segments.length ? 1 : 0) + (filters.cities.length ? 1 : 0) + (filters.states.length ? 1 : 0) +
    (filters.status !== "all" ? 1 : 0) + (filters.minOrders || filters.maxOrders ? 1 : 0) +
    (filters.minSpent || filters.maxSpent ? 1 : 0) + (filters.lastFrom || filters.lastTo ? 1 : 0) +
    (filters.joinedFrom || filters.joinedTo ? 1 : 0) + (filters.birthMonth ? 1 : 0) +
    (filters.hasEmail ? 1 : 0) + (filters.hasPhone ? 1 : 0) + (filters.mergedOnly ? 1 : 0) + (filters.activeOnly ? 1 : 0);

  const monthName = (m: number) =>
    new Date(2000, m - 1, 1).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { month: "long" });

  return (
    <div className="mt-8" id="all-customers">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">
          {t("allCustomers")} ({formatNumber(total)})
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <button className="btn-secondary" onClick={rebuild} disabled={busy} title={t("rebuildHint")}>
              <RefreshCw size={16} className={busy ? "animate-spin" : undefined} />
              {t("rebuildIdentities")}
            </button>
          )}
          <button className="btn-secondary" onClick={exportAll} disabled={exporting || !total}>
            <Download size={16} />
            {t("exportList")}
          </button>
        </div>
      </div>

      <p className="mb-3 text-xs text-slate-500">{t("browserHint")}</p>

      {/* Search + primary filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchBox
          className="w-full max-w-md"
          placeholder={t("searchCustomersPh")}
          value={searchInput}
          onChange={setSearchInput}
          onCommit={(v) => patch({ search: v })}
          active={!!filters.search}
        />
        <MultiSelect
          className="min-w-[11rem]"
          options={SEGMENTS}
          values={filters.segments}
          onChange={(v) => patch({ segments: v })}
          placeholder={t("segmentFilter")}
          getLabel={(v) => t(segmentKey(v))}
        />
        <MultiSelect
          className="min-w-[11rem]"
          options={options.cities}
          values={filters.cities}
          onChange={(v) => patch({ cities: v })}
          placeholder={t("city")}
        />
        <MultiSelect
          className="min-w-[11rem]"
          options={options.states}
          values={filters.states}
          onChange={(v) => patch({ states: v })}
          placeholder={t("lastState")}
        />
        <button
          type="button"
          className={cn("btn-secondary", showAdvanced && "!border-brand-400 !text-brand-700")}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          <SlidersHorizontal size={16} />
          {t("moreFilters")}
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">{activeFilterCount}</span>
          )}
        </button>
        {activeFilterCount > 0 && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-red-600"
            onClick={() => {
              setFilters(EMPTY);
              setSearchInput("");
              setPage(0);
            }}
          >
            <X size={13} />
            {t("clearFilters")}
          </button>
        )}
      </div>

      {/* Status chips */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => patch({ status: s })}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold transition",
              filters.status === s
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-slate-200 text-slate-500 hover:border-slate-300"
            )}
          >
            {t(statusKey(s))}
          </button>
        ))}
        <button
          type="button"
          onClick={() => patch({ mergedOnly: !filters.mergedOnly })}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition",
            filters.mergedOnly
              ? "border-violet-500 bg-violet-50 text-violet-700"
              : "border-slate-200 text-slate-500 hover:border-slate-300"
          )}
        >
          <Users2 size={12} />
          {t("mergedOnly")}
        </button>
      </div>

      {showAdvanced && (
        <div className="card mb-3 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumRange
            label={t("ltOrders")}
            min={filters.minOrders}
            max={filters.maxOrders}
            onMin={(v) => patch({ minOrders: v })}
            onMax={(v) => patch({ maxOrders: v })}
          />
          <NumRange
            label={t("totalSpent")}
            min={filters.minSpent}
            max={filters.maxSpent}
            onMin={(v) => patch({ minSpent: v })}
            onMax={(v) => patch({ maxSpent: v })}
          />
          <DateRangeInputs
            label={t("lastOrder")}
            from={filters.lastFrom}
            to={filters.lastTo}
            onFrom={(v) => patch({ lastFrom: v })}
            onTo={(v) => patch({ lastTo: v })}
          />
          <DateRangeInputs
            label={t("registeredAt")}
            from={filters.joinedFrom}
            to={filters.joinedTo}
            onFrom={(v) => patch({ joinedFrom: v })}
            onTo={(v) => patch({ joinedTo: v })}
          />
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("birthMonth")}
            </label>
            <select className="input" value={filters.birthMonth} onChange={(e) => patch({ birthMonth: e.target.value })}>
              <option value="">{t("filterAll")}</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{monthName(m)}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col justify-end gap-2 text-xs">
            <Check label={t("hasEmailFilter")} checked={filters.hasEmail} onChange={(v) => patch({ hasEmail: v })} />
            <Check label={t("hasPhoneFilter")} checked={filters.hasPhone} onChange={(v) => patch({ hasPhone: v })} />
            <Check label={t("activeOnly")} checked={filters.activeOnly} onChange={(v) => patch({ activeOnly: v })} />
          </div>
        </div>
      )}

      {canEdit && selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm">
          <span className="font-semibold text-brand-800">
            {t("selectedCount").replace("{n}", String(selected.length))}
          </span>
          <div className="flex items-center gap-2">
            <button className="btn-primary !py-1.5" onClick={mergeSelected} disabled={selected.length < 2 || busy}>
              <Merge size={15} />
              {t("mergeSelected")}
            </button>
            <button className="btn-secondary !py-1.5" onClick={() => setSelected([])}>
              {t("clear")}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">{t("noResults")}</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                {canEdit && <th className="w-8"></th>}
                <SortTh label={t("customer")} k="name" sort={sort} onToggle={toggleSort} />
                <th>{t("phone")}</th>
                <th>{t("email")}</th>
                <SortTh label={t("city")} k="city" sort={sort} onToggle={toggleSort} />
                <SortTh label={t("accountsCol")} k="accounts" sort={sort} onToggle={toggleSort} />
                <th>{t("segmentCol")}</th>
                <SortTh label={t("ltOrders")} k="orders" sort={sort} onToggle={toggleSort} />
                <SortTh label={t("deliveredCol")} k="delivered" sort={sort} onToggle={toggleSort} />
                <SortTh label={t("totalSpent")} k="spent" sort={sort} onToggle={toggleSort} />
                <SortTh label={t("lastOrder")} k="last" sort={sort} onToggle={toggleSort} />
                <SortTh label={t("registeredAt")} k="joined" sort={sort} onToggle={toggleSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.master_id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpenCustomer(c.master_id)}>
                  {canEdit && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-brand-600"
                        checked={selected.includes(c.master_id)}
                        onChange={(e) =>
                          setSelected((s) => (e.target.checked ? [...s, c.master_id] : s.filter((x) => x !== c.master_id)))
                        }
                      />
                    </td>
                  )}
                  <td className="font-medium">{c.name ?? c.master_id}</td>
                  <td dir="ltr" className="text-slate-600">{c.phone ?? "—"}</td>
                  <td dir="ltr" className="text-xs text-slate-500">{c.email ?? "—"}</td>
                  <td>{c.city ?? "—"}</td>
                  <td>
                    {c.accounts > 1 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700">
                        <Users2 size={10} />
                        {c.accounts}
                      </span>
                    ) : (
                      <span className="text-slate-300">1</span>
                    )}
                  </td>
                  <td className="text-xs">{c.segment ? t(segmentKey(c.segment)) : "—"}</td>
                  <td className="font-semibold">{formatNumber(c.lifetime_orders)}</td>
                  <td className="text-emerald-700">{formatNumber(c.lifetime_delivered)}</td>
                  <td className="font-semibold">{formatMoney(c.lifetime_delivered_amount, lang)}</td>
                  <td className="text-xs text-slate-500" dir="ltr">
                    {formatDate(c.last_order_at)}
                    {c.last_order_state && <span className="ms-1 text-slate-400">· {c.last_order_state}</span>}
                  </td>
                  <td className="text-xs text-slate-500" dir="ltr">{formatDate(c.first_joined_at)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <ContactActions phone={c.phone} email={c.email} name={c.name} waReason="general" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <div className="flex items-center gap-2">
          <span>
            {t("page")} {page + 1} {t("of")} {formatNumber(totalPages)}
          </span>
          <select
            className="input !w-auto !py-1 text-xs"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
          >
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
            {t("previous")}
          </button>
          <button className="btn-secondary" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>
            {t("next")}
          </button>
        </div>
      </div>
    </div>
  );
}

function segmentKey(seg: string) {
  return (
    {
      champions: "segChampions",
      loyal: "segLoyal",
      new: "segNew",
      promising: "segPromising",
      at_risk: "segAtRisk",
      hibernating: "segHibernating",
    } as const
  )[seg as "champions"] ?? "segChampions";
}

function statusKey(s: Status) {
  return (
    {
      all: "filterAll",
      buyers: "filterBuyers",
      repeat: "filterRepeat",
      one_time: "filterOneTime",
      never: "filterNever",
    } as const
  )[s];
}

function NumRange({
  label, min, max, onMin, onMax,
}: { label: string; min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void }) {
  const { t } = useLang();
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      <div className="flex items-center gap-1">
        <input className="input !py-1.5 text-sm" type="number" placeholder={t("min")} value={min} onChange={(e) => onMin(e.target.value)} />
        <span className="text-slate-400">–</span>
        <input className="input !py-1.5 text-sm" type="number" placeholder={t("max")} value={max} onChange={(e) => onMax(e.target.value)} />
      </div>
    </div>
  );
}

function DateRangeInputs({
  label, from, to, onFrom, onTo,
}: { label: string; from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      <div className="flex items-center gap-1">
        <input className="input !py-1.5 text-sm" type="date" value={from} onChange={(e) => onFrom(e.target.value)} />
        <span className="text-slate-400">–</span>
        <input className="input !py-1.5 text-sm" type="date" value={to} onChange={(e) => onTo(e.target.value)} />
      </div>
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
