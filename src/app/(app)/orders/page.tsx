"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Search, Download, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { useDateRange, DateRangeFilter } from "@/components/date-range";
import { PageHeader, StatusBadge, Spinner } from "@/components/ui";
import { formatMoney, formatDateTime, formatNumber } from "@/lib/utils";
import { ContactActions } from "@/components/contact-actions";
import type { Order, OrderItem, OrderEvent } from "@/lib/types";

const PAGE_SIZE = 25;

export default function OrdersPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const { preset, setPreset, range, setRange } = useDateRange("all");

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [status, setStatus] = useState("");
  const [payment, setPayment] = useState("");
  const [city, setCity] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Order | null>(null);
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

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("orders").select("*", { count: "exact" });
    if (range.from) query = query.gte("order_date", `${range.from}T00:00:00Z`);
    if (range.to) query = query.lte("order_date", `${range.to}T23:59:59Z`);
    if (status) query = query.eq("order_status", status);
    if (payment) query = query.eq("payment_method", payment);
    if (city) query = query.eq("city", city);
    if (source) query = query.eq("source", source);
    if (search) {
      query = query.or(
        `order_number.ilike.%${search}%,customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%,awb_number.ilike.%${search}%`
      );
    }
    const { data, count } = await query
      .order("order_date", { ascending: false, nullsFirst: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    setRows((data as Order[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [supabase, range.from, range.to, status, payment, city, source, search, page]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // changing the date range must restart pagination
  useEffect(() => {
    setPage(0);
  }, [range.from, range.to]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function exportCsv() {
    const params = new URLSearchParams();
    if (range.from) params.set("from", `${range.from}T00:00:00Z`);
    if (range.to) params.set("to", `${range.to}T23:59:59Z`);
    if (status) params.set("status", status);
    if (payment) params.set("payment", payment);
    if (city) params.set("city", city);
    if (source) params.set("source", source);
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
        <DateRangeFilter preset={preset} setPreset={setPreset} range={range} setRange={setRange} />
        <div className="grid gap-2 md:grid-cols-5">
          <form
            className="relative md:col-span-2"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(0);
              setSearch(searchInput.trim());
            }}
          >
            <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input ps-9"
              placeholder={t("searchOrders")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </form>
          <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
            <option value="">{t("allStatuses")}</option>
            {filterOptions.statuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select className="input" value={payment} onChange={(e) => { setPayment(e.target.value); setPage(0); }}>
            <option value="">{t("allPayments")}</option>
            {filterOptions.payments.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select className="input" value={city} onChange={(e) => { setCity(e.target.value); setPage(0); }}>
            <option value="">{t("allCities")}</option>
            {filterOptions.cities.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
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
                <th>{t("orderNumber")}</th>
                <th>{t("orderDate")}</th>
                <th>{t("customer")}</th>
                <th>{t("city")}</th>
                <th>{t("status")}</th>
                <th>{t("paymentMethod")}</th>
                <th>{t("amount")}</th>
                <th>{t("itemsCount")}</th>
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
