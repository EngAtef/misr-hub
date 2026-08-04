"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  X, User, ShoppingBag, MapPin, Cake, CalendarClock, Package, Users2, Unlink, Crown, AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { Spinner } from "@/components/ui";
import { formatMoney, formatNumber, formatDate, formatDateTime, cn } from "@/lib/utils";
import { ContactActions } from "@/components/contact-actions";
import { useMyRole } from "@/lib/use-role";

export interface Identity {
  master_id: string;
  accounts: number;
  account_ids: string[] | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  area: string | null;
  addresses: string | null;
  birthdate: string | null;
  language: string | null;
  is_active: boolean | null;
  phones: string[] | null;
  emails: string[] | null;
  first_joined_at: string | null;
  lifetime_orders: number;
  lifetime_delivered: number;
  lifetime_canceled: number;
  lifetime_amount: number;
  lifetime_delivered_amount: number;
  lifetime_canceled_amount: number;
  last_order_at: string | null;
  last_order_state: string | null;
  last_delivered_at: string | null;
  app_orders: number;
  app_amount: number;
  first_order_at: string | null;
  last_app_order_at: string | null;
  recency_days: number | null;
  segment: string | null;
  has_stats: boolean;
}

interface AccountRow {
  customer_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  joined_at: string | null;
  birthdate: string | null;
  is_active: boolean | null;
  lifetime_orders: number | null;
  lifetime_delivered: number | null;
  lifetime_delivered_amount: number | null;
  last_order_at: string | null;
  last_order_state: string | null;
  is_master: boolean;
  override: { keep_separate: boolean; force_master: string | null } | null;
}

interface OrderRow {
  order_number: string;
  customer_id: string | null;
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
  applied_offer: string | null;
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

// Slide-over with the FULL picture of one PERSON: every platform
// account that belongs to them (guest checkouts create new ones), the
// merged lifetime figures, and every order any of those accounts placed.
// `customerId` accepts a master id or any linked account id.
export function CustomerDrawer({
  customerId,
  onClose,
  onChanged,
}: {
  customerId: string | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { t, lang } = useLang();
  const role = useMyRole();
  const canEdit = role === "admin" || role === "manager";
  const supabase = useMemo(() => createClient(), []);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<Map<string, ItemRow[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    const { data } = await supabase.rpc("fn_identity_detail", { p_key: customerId });
    const payload = data as { identity: Identity | null; accounts: AccountRow[]; orders: OrderRow[] } | null;
    const orderRows = payload?.orders ?? [];
    setIdentity(payload?.identity ?? null);
    setAccounts(payload?.accounts ?? []);
    setOrders(orderRows);
    setLoading(false);

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
      setItems(map);
    } else {
      setItems(new Map());
    }
  }, [customerId, supabase]);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    setIdentity(null);
    setAccounts([]);
    setOrders([]);
    setItems(new Map());
    setShowAccounts(false);
    (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId, load]);

  async function unlink(accountId: string) {
    if (!confirm(t("unlinkConfirm"))) return;
    setBusy(true);
    const { error } = await supabase.rpc("fn_split_customer", { p_customer_id: accountId });
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    await load();
    onChanged?.();
  }

  async function relink(accountId: string) {
    setBusy(true);
    const { error } = await supabase.rpc("fn_clear_customer_override", { p_customer_id: accountId });
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    await load();
    onChanged?.();
  }

  if (!customerId) return null;

  const merged = (identity?.accounts ?? 1) > 1;
  const hasStats = !!identity?.has_stats;

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
              <h2 className="font-bold text-lg leading-tight">{identity?.name ?? customerId}</h2>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span dir="ltr">#{identity?.master_id ?? customerId}</span>
                {merged && (
                  <button
                    type="button"
                    onClick={() => setShowAccounts((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 font-semibold text-violet-700"
                  >
                    <Users2 size={11} />
                    {t("mergedFrom").replace("{n}", String(identity?.accounts ?? 0))}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {identity && (
              <ContactActions phone={identity.phone} email={identity.email} name={identity.name} waReason="general" />
            )}
            <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label={t("close")}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && !identity ? (
            <Spinner />
          ) : !identity ? (
            <div className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">{t("noData")}</div>
          ) : (
            <>
              {/* Profile */}
              <div className="card p-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <Field label={t("phone")} value={identity.phone} ltr />
                  <Field label={t("email")} value={identity.email} ltr />
                  <Field label={t("city")} value={identity.city} />
                  <Field label={t("area")} value={identity.area} />
                  <Field label={t("birthDate")} value={identity.birthdate ? formatDate(identity.birthdate) : null} icon={Cake} />
                  <Field
                    label={t("registeredAt")}
                    value={identity.first_joined_at ? formatDate(identity.first_joined_at) : null}
                    icon={CalendarClock}
                  />
                </div>
                {(identity.phones?.length ?? 0) > 1 && (
                  <div className="mt-3 text-xs">
                    <span className="text-slate-400">{t("otherPhones")}: </span>
                    <span dir="ltr">{identity.phones!.join(" · ")}</span>
                  </div>
                )}
                {(identity.emails?.length ?? 0) > 1 && (
                  <div className="mt-1 text-xs">
                    <span className="text-slate-400">{t("otherEmails")}: </span>
                    <span dir="ltr">{identity.emails!.join(" · ")}</span>
                  </div>
                )}
                {identity.addresses && (
                  <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />
                    {identity.addresses}
                  </div>
                )}
              </div>

              {/* Merged accounts */}
              {merged && (
                <div className="card p-4">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 text-start"
                    onClick={() => setShowAccounts((v) => !v)}
                  >
                    <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
                      <Users2 size={16} className="text-violet-600" />
                      {t("linkedAccounts")} ({identity.accounts})
                    </span>
                    <span className="text-xs text-brand-600">{showAccounts ? t("hide") : t("show")}</span>
                  </button>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{t("linkedAccountsHint")}</p>
                  {showAccounts && (
                    <div className="mt-3 space-y-2">
                      {accounts.map((a) => (
                        <div
                          key={a.customer_id}
                          className={cn(
                            "rounded-lg border px-3 py-2 text-xs",
                            a.is_master ? "border-brand-200 bg-brand-50/50" : "border-slate-200"
                          )}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {a.is_master && <Crown size={12} className="text-amber-500" />}
                              <span className="font-semibold">{a.name ?? "—"}</span>
                              <span className="text-slate-400" dir="ltr">#{a.customer_id}</span>
                            </div>
                            {canEdit && !a.is_master && (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-semibold text-slate-600 hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                                disabled={busy}
                                onClick={() => unlink(a.customer_id)}
                              >
                                <Unlink size={11} />
                                {t("unlinkAccount")}
                              </button>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-slate-500">
                            {a.phone && <span dir="ltr">{a.phone}</span>}
                            {a.email && <span dir="ltr">{a.email}</span>}
                            <span>
                              {t("registeredAt")}: <span dir="ltr">{formatDate(a.joined_at)}</span>
                            </span>
                            <span>
                              {t("ltOrders")}: {formatNumber(a.lifetime_orders ?? 0)}
                            </span>
                            <span>
                              {t("totalSpent")}: {formatMoney(a.lifetime_delivered_amount ?? 0, lang)}
                            </span>
                          </div>
                          {a.override?.keep_separate && (
                            <div className="mt-1 flex items-center gap-1 text-amber-600">
                              <AlertTriangle size={11} />
                              {t("keptSeparate")}
                              {canEdit && (
                                <button type="button" className="underline" disabled={busy} onClick={() => relink(a.customer_id)}>
                                  {t("undo")}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                      {canEdit &&
                        accounts.some((a) => a.override?.keep_separate) === false &&
                        accounts.length > 1 && (
                          <p className="text-[11px] text-slate-400">{t("unlinkHint")}</p>
                        )}
                    </div>
                  )}
                </div>
              )}

              {/* Lifetime stats (merged) */}
              {hasStats && (
                <div className="grid grid-cols-3 gap-3">
                  <Stat
                    label={t("ltOrders")}
                    value={formatNumber(identity.lifetime_orders)}
                    sub={formatMoney(identity.lifetime_amount, lang)}
                  />
                  <Stat
                    label={t("deliveredCol")}
                    value={formatNumber(identity.lifetime_delivered)}
                    sub={formatMoney(identity.lifetime_delivered_amount, lang)}
                    tone="good"
                  />
                  <Stat
                    label={t("canceledCol")}
                    value={formatNumber(identity.lifetime_canceled)}
                    sub={formatMoney(identity.lifetime_canceled_amount, lang)}
                    tone="bad"
                  />
                </div>
              )}
              {hasStats && identity.last_order_at && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-500">{t("lastOrder")}:</span>
                  <span dir="ltr" className="font-semibold">{formatDate(identity.last_order_at)}</span>
                  {identity.last_order_state && (
                    <span className={cn("rounded-full px-2 py-0.5 font-semibold", statusTone(identity.last_order_state))}>
                      {identity.last_order_state}
                    </span>
                  )}
                  {identity.last_delivered_at && (
                    <span className="text-slate-400">
                      {t("lastDeliveredLbl")}: <span dir="ltr">{formatDate(identity.last_delivered_at)}</span>
                    </span>
                  )}
                </div>
              )}

              {/* Orders across every linked account */}
              <div>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                  <ShoppingBag size={16} />
                  {t("ordersHistory")} ({formatNumber(orders.length)})
                  {merged && <span className="text-[11px] font-normal text-slate-400">— {t("acrossAccounts")}</span>}
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
                            {merged && o.customer_id && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500" dir="ltr">
                                #{o.customer_id}
                              </span>
                            )}
                          </div>
                          <span className="font-bold">{formatMoney(o.total_order_amount ?? 0, lang)}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                          <span dir="ltr">{formatDateTime(o.order_date)}</span>
                          {o.payment_method && <span>{o.payment_method}</span>}
                          {(o.city || o.area) && <span>{[o.city, o.area].filter(Boolean).join(" — ")}</span>}
                          {o.source && <span dir="ltr">{o.source}</span>}
                          {o.applied_offer && <span className="text-emerald-600" dir="ltr">{o.applied_offer}</span>}
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
