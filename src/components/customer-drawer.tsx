"use client";

import { useEffect, useMemo, useState } from "react";
import { X, User, ShoppingBag, MapPin, Cake, CalendarClock, Package } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { Spinner } from "@/components/ui";
import { formatMoney, formatNumber, formatDate, formatDateTime, cn } from "@/lib/utils";
import { ContactActions } from "@/components/contact-actions";

interface CustomerFull {
  customer_id: string;
  name: string | null;
  email: string | null;
  birthdate: string | null;
  phone: string | null;
  total_orders: number | null;
  language: string | null;
  is_active: boolean | null;
  joined_at: string | null;
  city: string | null;
  area: string | null;
  addresses: string | null;
  lifetime_orders: number | null;
  lifetime_delivered: number | null;
  lifetime_canceled: number | null;
  lifetime_amount: number | null;
  lifetime_delivered_amount: number | null;
  lifetime_canceled_amount: number | null;
  last_order_at: string | null;
  last_order_state: string | null;
  last_delivered_at: string | null;
  stats_updated_at: string | null;
}

interface OrderRow {
  order_number: string;
  order_date: string | null;
  order_status: string | null;
  delivery_status: string | null;
  payment_method: string | null;
  total_order_amount: number | null;
  city: string | null;
  area: string | null;
  source: string | null;
  items_count: number | null;
  cancellation_reason: string | null;
}

interface ItemRow {
  order_number: string;
  product_name: string | null;
  sku: string | null;
  price: number | null;
}

function statusTone(status: string | null): string {
  if (!status) return "bg-slate-100 text-slate-600";
  if (status === "Delivered") return "bg-emerald-100 text-emerald-800";
  if (["Cancelled", "Canceled"].includes(status)) return "bg-red-100 text-red-700";
  if (status.toLowerCase().includes("return")) return "bg-orange-100 text-orange-800";
  return "bg-amber-100 text-amber-800";
}

// Slide-over with the FULL picture of one customer: profile fields,
// lifetime history stats, and every order (with its items) we have.
export function CustomerDrawer({ customerId, onClose }: { customerId: string | null; onClose: () => void }) {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [customer, setCustomer] = useState<CustomerFull | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<Map<string, ItemRow[]>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setCustomer(null);
      setOrders([]);
      setItems(new Map());
      const [{ data: cust }, { data: ords }] = await Promise.all([
        supabase.from("customers").select("*").eq("customer_id", customerId).maybeSingle(),
        supabase
          .from("orders")
          .select("order_number, order_date, order_status, delivery_status, payment_method, total_order_amount, city, area, source, items_count, cancellation_reason")
          .eq("customer_id", customerId)
          .order("order_date", { ascending: false })
          .limit(300),
      ]);
      if (cancelled) return;
      const orderRows = (ords as OrderRow[]) ?? [];
      setCustomer((cust as CustomerFull) ?? null);
      setOrders(orderRows);
      if (orderRows.length) {
        const numbers = orderRows.map((o) => o.order_number);
        const map = new Map<string, ItemRow[]>();
        for (let i = 0; i < numbers.length; i += 100) {
          const { data: its } = await supabase
            .from("order_items")
            .select("order_number, product_name, sku, price")
            .in("order_number", numbers.slice(i, i + 100));
          for (const it of (its as ItemRow[]) ?? []) {
            const list = map.get(it.order_number) ?? [];
            list.push(it);
            map.set(it.order_number, list);
          }
        }
        if (cancelled) return;
        setItems(map);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId, supabase]);

  if (!customerId) return null;

  const hasStats = !!customer?.stats_updated_at;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="absolute inset-y-0 end-0 flex w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-brand-50 p-2 text-brand-600">
              <User size={20} />
            </div>
            <div>
              <h2 className="font-bold text-lg leading-tight">{customer?.name ?? customerId}</h2>
              <div className="text-xs text-slate-400" dir="ltr">#{customerId}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {customer && <ContactActions phone={customer.phone} email={customer.email} name={customer.name} waReason="general" />}
            <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label={t("close")}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && !customer ? (
            <Spinner />
          ) : (
            <>
              {/* Profile */}
              <div className="card p-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <Field label={t("phone")} value={customer?.phone} ltr />
                  <Field label={t("email")} value={customer?.email} ltr />
                  <Field label={t("city")} value={customer?.city} />
                  <Field label={t("area")} value={customer?.area} />
                  <Field label={t("birthDate")} value={customer?.birthdate ? formatDate(customer.birthdate) : null} icon={Cake} />
                  <Field label={t("registeredAt")} value={customer?.joined_at ? formatDate(customer.joined_at) : null} icon={CalendarClock} />
                </div>
                {customer?.addresses && (
                  <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />
                    {customer.addresses}
                  </div>
                )}
              </div>

              {/* Lifetime stats */}
              {hasStats && customer && (
                <div className="grid grid-cols-3 gap-3">
                  <Stat label={t("ltOrders")} value={formatNumber(customer.lifetime_orders ?? 0)} sub={formatMoney(customer.lifetime_amount ?? 0, lang)} />
                  <Stat
                    label={t("deliveredCol")}
                    value={formatNumber(customer.lifetime_delivered ?? 0)}
                    sub={formatMoney(customer.lifetime_delivered_amount ?? 0, lang)}
                    tone="good"
                  />
                  <Stat
                    label={t("canceledCol")}
                    value={formatNumber(customer.lifetime_canceled ?? 0)}
                    sub={formatMoney(customer.lifetime_canceled_amount ?? 0, lang)}
                    tone="bad"
                  />
                </div>
              )}
              {hasStats && customer?.last_order_at && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-500">{t("lastOrder")}:</span>
                  <span dir="ltr" className="font-semibold">{formatDate(customer.last_order_at)}</span>
                  {customer.last_order_state && (
                    <span className={cn("rounded-full px-2 py-0.5 font-semibold", statusTone(customer.last_order_state))}>
                      {customer.last_order_state}
                    </span>
                  )}
                  {customer.last_delivered_at && (
                    <span className="text-slate-400">
                      {t("lastDeliveredLbl")}: <span dir="ltr">{formatDate(customer.last_delivered_at)}</span>
                    </span>
                  )}
                </div>
              )}

              {/* Orders */}
              <div>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                  <ShoppingBag size={16} />
                  {t("ordersHistory")} ({formatNumber(orders.length)})
                </h3>
                {loading ? (
                  <Spinner />
                ) : orders.length === 0 ? (
                  <div className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">{t("noOrdersInApp")}</div>
                ) : (
                  <div className="space-y-3">
                    {orders.map((o) => (
                      <div key={o.order_number} className="card p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold" dir="ltr">#{o.order_number}</span>
                            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", statusTone(o.order_status))}>
                              {o.order_status ?? "—"}
                            </span>
                          </div>
                          <span className="font-bold">{formatMoney(o.total_order_amount ?? 0, lang)}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                          <span dir="ltr">{formatDateTime(o.order_date)}</span>
                          {o.payment_method && <span>{o.payment_method}</span>}
                          {(o.city || o.area) && <span>{[o.city, o.area].filter(Boolean).join(" — ")}</span>}
                          {o.source && <span dir="ltr">{o.source}</span>}
                        </div>
                        {o.cancellation_reason && (
                          <div className="mt-1.5 text-xs text-red-600">{o.cancellation_reason}</div>
                        )}
                        {(items.get(o.order_number) ?? []).length > 0 && (
                          <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                            {(items.get(o.order_number) ?? []).map((it, i) => (
                              <div key={i} className="flex items-center justify-between gap-2 text-xs">
                                <span className="flex items-center gap-1.5 text-slate-700">
                                  <Package size={12} className="shrink-0 text-slate-300" />
                                  {it.product_name ?? it.sku ?? "—"}
                                </span>
                                <span className="shrink-0 text-slate-500">{it.price !== null ? formatMoney(it.price, lang) : ""}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, ltr, icon: Icon }: { label: string; value: string | null | undefined; ltr?: boolean; icon?: React.ElementType }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {Icon && <Icon size={12} />}
        {label}
      </div>
      <div className={cn("mt-0.5 font-medium", !value && "text-slate-300")} dir={ltr ? "ltr" : undefined}>
        {value ?? "—"}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className={cn("card p-3 text-center", tone === "good" && "bg-emerald-50/50", tone === "bad" && "bg-red-50/50")}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn("mt-0.5 text-xl font-bold", tone === "good" && "text-emerald-700", tone === "bad" && "text-red-700")}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}
