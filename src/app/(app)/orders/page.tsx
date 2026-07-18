"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { useDateRange, DateRangeFilter } from "@/components/date-range";
import { PageHeader, StatusBadge, Spinner, SortTh, useSort, DeltaBadge } from "@/components/ui";
import { MultiSelect } from "@/components/multi-select";
import { SearchBox } from "@/components/search-box";
import { formatMoney, formatDateTime, formatNumber, sanitizeSearch } from "@/lib/utils";
import { ContactActions } from "@/components/contact-actions";
import type { Order, OrderItem, OrderEvent } from "@/lib/types";

const PAGE_SIZE = 25;

export default function OrdersPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const { preset, setPreset, range, setRange, comparePreset, setComparePreset, customCompare, setCustomCompare, compare } = useDateRange("30d");
  const [compareTotal, setCompareTotal] = useState<number | null>(null);

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [payment, setPayment] = useState<string[]>([]);
  const [city, setCity] = useState<string[]>([]);
  const [source, setSource] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Order | null>(null);
  const { sort, toggle } = useSort<Order>();
  const [filterOptions, setFilterOptions] = useState<{ statuses: string[]; payments: string[]; cities: string[]; sources: string[] }>({
    statuses: [],
    payments: [],
    cities: [],
    sources: [],
  });

  useEffect(() => {
    async function loadOptions() {
      const [s, p, c, src] = await Promise.all([
        supabase.rpc("fn_breakdown", { p_dim: "order_status", p_from: null, p_to: null, p_limit: 50 }),
        supabase.rpc("fn_breakdown", { p_dim: "payment_method", p_from: null, p_to: null, p_limit: 20 }),
        supabase.rpc("fn_breakdown", { p_dim: "city", p_from: null, p_to: null, p_limit: 50 }),
        supabase.rpc("fn_breakdown", { p_dim: "source", p_from: null, p_to: null, p_limit: 10 }),
      ]);
      const labels = (d: unknown) =>
        ((d as { label: string }[] | null) ?? []).map((x) => x.label).filter((x) => x !== "(none)");
      setFilterOptions({
        statuses: labels(s.data),
        payments: labels(p.data),
        cities: labels(c.data),
        sources: labels(src.data),
      });
    }
    loadOptions();
  }, [supabase]);

  // guarded against overlapping fetches: a slow stale response must never
  // overwrite the rows of a newer filter selection
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      let query = supabase.from("orders").select("*", { count: "exact" });
      if (range.from) query = query.gte("order_date", `${range.from}T00:00:00Z`);
      if (range.to) query = query.lte("order_date", `${range.to}T23:59:59Z`);
      if (status.length) query = query.in("order_status", status);
      if (payment.length) query = query.in("payment_method", payment);
      if (city.length) query = query.in("city", city);
      if (source.length) query = query.in("source", source);
      if (search) {
        const s = sanitizeSearch(search);
        if (s) {
          query = query.or(
            `order_number.ilike.%${s}%,customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%,awb_number.ilike.%${s}%`
          );
        }
      }
      // sorting happens in the database so it covers all pages, not just the visible one
      const { data, count } = await query
        .order(sort?.key ?? "order_date", { ascending: sort?.dir === "asc", nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (cancelled) return;
      setRows((data as Order[]) ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, range.from, range.to, status, payment, city, source, search, page, sort]);

  // same filters, comparison period -> matching order count
  useEffect(() => {
    if (!compare) {
      setCompareTotal(null);
      return;
    }
    let cancelled = false;
    (async () => {
      let query = supabase.from("orders").select("order_number", { count: "exact", head: true });
      if (compare.from) query = query.gte("order_date", `${compare.from}T00:00:00Z`);
      if (compare.to) query = query.lte("order_date", `${compare.to}T23:59:59Z`);
      if (status.length) query = query.in("order_status", status);
      if (payment.length) query = query.in("payment_method", payment);
      if (city.length) query = query.in("city", city);
      if (source.length) query = query.in("source", source);
      if (search) {
        const s = sanitizeSearch(search);
        if (s) {
          query = query.or(
            `order_number.ilike.%${s}%,customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%,awb_number.ilike.%${s}%`
          );
        }
      }
      const { count } = await query;
      if (!cancelled) setCompareTotal(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, compare, status, payment, city, source, search]);

  // changing the date range must restart pagination
  useEffect(() => {
    setPage(0);
  }, [range.from, range.to]);

  // ?q= deep link from the sidebar quick search
  useEffect(() => {
    const onNav = () => {
      const q = new URLSearchParams(window.location.search).get("q");
      if (q !== null && q !== "") {
        setSearchInput(q);
        setSearch(q.trim());
        setPage(0);
      }
    };
    onNav();
    window.addEventListener("popstate", onNav);
    return () => window.removeEventListener("popstate", onNav);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function onSort(key: string) {
    toggle(key);
    setPage(0);
  }

  function exportCsv() {
    const params = new URLSearchParams();
    if (range.from) params.set("from", `${range.from}T00:00:00Z`);
    if (range.to) params.set("to", `${range.to}T23:59:59Z`);
    for (const s of status) params.append("status", s);
    for (const p of payment) params.append("payment", p);
    for (const c of city) params.append("city", c);
    for (const s of source) params.append("source", s);
    if (search) params.set("q", search);
    window.open(`/api/export?${params.toString()}`, "_blank");
  }

  return (
    <div>
      <PageHeader
        title={t("orders")}
        subtitle={`${formatNumber(total)} ${t("ordersLabel")}`}
        actions={
          <button onClick={exportCsv} className="btn-secondary">
            <Download size={16} />
            {t("exportCsv")}
          </button>
        }
      />

      <div className="card p-4 mb-4 space-y-3">
        <DateRangeFilter
          preset={preset}
          setPreset={setPreset}
          range={range}
          setRange={setRange}
          comparePreset={comparePreset}
          setComparePreset={setComparePreset}
          customCompare={customCompare}
          setCustomCompare={setCustomCompare}
          compare={compare}
        />
        {compare && compareTotal !== null && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-violet-50 border border-violet-100 px-4 py-2.5 text-sm text-violet-900">
            <span className="font-semibold">{t("results")}:</span>
            <span className="font-bold" dir="ltr">{formatNumber(total)}</span>
            <DeltaBadge current={total} previous={compareTotal} fmtPrev={formatNumber} />
            <span className="text-xs text-violet-500">
              {t("vsLbl")} {formatNumber(compareTotal)} ({compare.from} → {compare.to})
            </span>
          </div>
        )}
        <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-6">
          <SearchBox
            className="md:col-span-3 lg:col-span-2"
            placeholder={t("searchOrders")}
            value={searchInput}
            onChange={setSearchInput}
            onCommit={(v) => {
              setPage(0);
              setSearch(v);
            }}
            active={!!search}
          />
          <MultiSelect
            options={filterOptions.statuses}
            values={status}
            onChange={(v) => { setStatus(v); setPage(0); }}
            placeholder={t("allStatuses")}
          />
          <MultiSelect
            options={filterOptions.payments}
            values={payment}
            onChange={(v) => { setPayment(v); setPage(0); }}
            placeholder={t("allPayments")}
          />
          <MultiSelect
            options={filterOptions.cities}
            values={city}
            onChange={(v) => { setCity(v); setPage(0); }}
            placeholder={t("allCities")}
          />
          <MultiSelect
            options={filterOptions.sources}
            values={source}
            onChange={(v) => { setSource(v); setPage(0); }}
            placeholder={t("allSources")}
          />
        </div>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-500">{t("noResults")}</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <SortTh label={t("orderNumber")} k="order_number" sort={sort} onToggle={onSort} />
                <SortTh label={t("orderDate")} k="order_date" sort={sort} onToggle={onSort} />
                <SortTh label={t("customer")} k="customer_name" sort={sort} onToggle={onSort} />
                <SortTh label={t("city")} k="city" sort={sort} onToggle={onSort} />
                <SortTh label={t("status")} k="order_status" sort={sort} onToggle={onSort} />
                <SortTh label={t("paymentMethod")} k="payment_method" sort={sort} onToggle={onSort} />
                <SortTh label={t("amount")} k="total_order_amount" sort={sort} onToggle={onSort} />
                <SortTh label={t("itemsCount")} k="items_count" sort={sort} onToggle={onSort} />
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.order_number} onClick={() => setSelected(o)} className="cursor-pointer">
                  <td className="font-bold text-brand-700" dir="ltr">#{o.order_number}</td>
                  <td className="text-xs text-slate-500">{formatDateTime(o.order_date)}</td>
                  <td>
                    <div className="font-medium">{o.customer_name ?? "—"}</div>
                    <div className="text-xs text-slate-400" dir="ltr">{o.customer_phone ?? ""}</div>
                  </td>
                  <td>{o.city ?? "—"}</td>
                  <td><StatusBadge status={o.order_status} /></td>
                  <td className="text-xs">{o.payment_method ?? "—"}</td>
                  <td className="font-semibold">{formatMoney(o.total_order_amount, lang)}</td>
                  <td className="text-center">{o.items_count ?? "—"}</td>
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
          <button className="btn-secondary" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>
            {t("next")}
          </button>
        </div>
      </div>

      {selected && <OrderDetail order={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function OrderDetail({ order, onClose }: { order: Order; onClose: () => void }) {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [i, e] = await Promise.all([
        supabase.from("order_items").select("*").eq("order_number", order.order_number).order("position"),
        supabase.from("order_events").select("*").eq("order_number", order.order_number).order("seq"),
      ]);
      setItems((i.data as OrderItem[]) ?? []);
      setEvents((e.data as OrderEvent[]) ?? []);
      setLoading(false);
    }
    load();
  }, [supabase, order.order_number]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between bg-white border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold" dir="ltr">
              {t("orderDetails")} #{order.order_number}
            </h2>
            <div className="text-xs text-slate-500">{formatDateTime(order.order_date)}</div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={order.order_status} />
            {order.delivery_status && <StatusBadge status={order.delivery_status} />}
            <div className="ms-auto">
              <ContactActions
                phone={order.customer_phone}
                name={order.customer_name}
                waReason="general"
                orderNumber={order.order_number}
                compact={false}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="card p-4">
              <h3 className="text-xs font-bold uppercase text-slate-500 mb-2">{t("customer")}</h3>
              <div className="text-sm space-y-1">
                <div className="font-semibold">{order.customer_name ?? "—"}</div>
                <div dir="ltr" className="text-slate-600">{order.customer_phone ?? "—"}</div>
                <div className="text-slate-600">
                  {[order.city, order.area, order.district].filter(Boolean).join(" — ") || "—"}
                </div>
                {order.full_address && <div className="text-xs text-slate-500">{order.full_address}</div>}
              </div>
            </div>
            <div className="card p-4">
              <h3 className="text-xs font-bold uppercase text-slate-500 mb-2">{t("paymentInfo")}</h3>
              <div className="text-sm space-y-1">
                <div>{order.payment_method ?? "—"}</div>
                <div className="font-bold text-lg">{formatMoney(order.total_order_amount, lang)}</div>
                {order.cod_amount != null && order.cod_amount > 0 && (
                  <div className="text-xs text-amber-700">COD: {formatMoney(order.cod_amount, lang)}</div>
                )}
                {order.awb_number && (
                  <div className="text-xs text-slate-500" dir="ltr">
                    {t("awb")}: {order.awb_number}
                  </div>
                )}
              </div>
            </div>
          </div>

          {(order.cancellation_reason || order.customer_notes || order.admin_notes) && (
            <div className="card p-4 space-y-1 text-sm">
              {order.cancellation_reason && (
                <div className="text-red-700">
                  <span className="font-semibold">{t("cancellationReasons")}:</span> {order.cancellation_reason}
                  {order.cancellation_note ? ` — ${order.cancellation_note}` : ""}
                </div>
              )}
              {order.customer_notes && (
                <div><span className="font-semibold">{t("notes")}:</span> {order.customer_notes}</div>
              )}
              {order.admin_notes && (
                <div className="text-slate-600"><span className="font-semibold">Admin:</span> {order.admin_notes}</div>
              )}
            </div>
          )}

          {loading ? (
            <Spinner />
          ) : (
            <>
              <div>
                <h3 className="text-sm font-bold mb-2">{t("orderItems")} ({items.length})</h3>
                <div className="card overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>{t("products")}</th>
                        <th>SKU</th>
                        <th>{t("amount")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.position}>
                          <td className="text-slate-400">{it.position}</td>
                          <td className="!whitespace-normal">{it.product_name ?? "—"}</td>
                          <td dir="ltr" className="text-xs text-slate-500">{it.sku ?? "—"}</td>
                          <td>{formatMoney(it.price, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold mb-2">{t("orderTimeline")}</h3>
                <div className="space-y-0">
                  {events.map((ev, i) => (
                    <div key={ev.seq} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="h-3 w-3 rounded-full bg-brand-500 mt-1.5" />
                        {i < events.length - 1 && <div className="w-px flex-1 bg-slate-200" />}
                      </div>
                      <div className="pb-4">
                        <div className="text-sm font-semibold">{ev.state_name}</div>
                        <div className="text-xs text-slate-500">
                          {formatDateTime(ev.state_date)}
                          {ev.admin_name ? ` — ${ev.admin_name}` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
