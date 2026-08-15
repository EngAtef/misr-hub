"use client";

import { useEffect, useMemo, useState } from "react";
import { Crown, Heart, Sparkles, Sprout, AlertTriangle, Moon, Download, Cake, UserX, Trophy, MapPin, PackageSearch, RotateCcw, History, Users2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { PageHeader, Spinner, EmptyState, SortTh, useSort } from "@/components/ui";
import { formatMoney, formatNumber, formatDate, toCsv, downloadCsv, cn } from "@/lib/utils";
import { ContactActions } from "@/components/contact-actions";
import { CustomerDrawer } from "@/components/customer-drawer";
import { CustomerBrowser } from "@/components/customer-browser";
import { rpcAll } from "@/lib/rpc-all";

interface WinbackRow {
  customer_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  language: string | null;
  joined_at: string | null;
}

interface BirthdayRow {
  customer_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  birthdate: string | null;
  birth_day: number;
  orders: number;
  lifetime_orders: number | null;
  total_spent: number;
  last_order: string | null;
}

interface SegmentSummary {
  segment: string;
  customers: number;
  total_revenue: number;
  avg_orders: number;
  avg_spend: number;
  avg_recency_days: number;
}

interface SegmentCustomer {
  customer_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  city: string | null;
  orders: number;
  total_spent: number;
  last_order_date: string | null;
  recency_days: number;
}

interface ValueSummary {
  accounts: number;
  people: number;
  merged_people: number;
  duplicate_accounts: number;
  buyers: number;
  delivered_buyers: number;
  never_ordered: number;
  repeat_buyers: number;
  one_timers: number;
  repeat_buyers_unmerged: number;
  repeat_hidden_by_dupes: number;
  lifetime_orders_total: number;
  lifetime_delivered_total: number;
  lifetime_canceled_total: number;
  lifetime_amount_total: number;
  delivered_amount_total: number;
  canceled_amount_total: number;
  avg_ltv: number;
  avg_orders_per_person: number;
  stats_updated_at: string | null;
  rebuilt_at: string | null;
}

interface TopCustomer {
  customer_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  lifetime_orders: number;
  lifetime_delivered: number;
  lifetime_canceled: number;
  lifetime_amount: number;
  lifetime_delivered_amount: number;
  last_order_at: string | null;
  last_order_state: string | null;
  last_delivered_at: string | null;
}

interface CityStat {
  city: string;
  customers: number;
  buyers: number;
  delivered_orders: number;
  delivered_amount: number;
  canceled_orders: number;
  canceled_amount: number;
  avg_ltv: number;
}

interface StuckRow {
  customer_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  last_order_at: string | null;
  last_order_state: string | null;
  lifetime_orders: number;
  lifetime_delivered: number;
  lifetime_amount: number;
}

interface ChurnedRow {
  customer_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  lifetime_delivered: number;
  lifetime_delivered_amount: number;
  last_order_at: string | null;
  last_order_state: string | null;
}

const SEGMENT_META: Record<string, { labelKey: DictKey; descKey: DictKey; icon: React.ElementType; color: string }> = {
  champions: { labelKey: "segChampions", descKey: "segChampionsDesc", icon: Crown, color: "text-amber-600 bg-amber-50 border-amber-200" },
  loyal: { labelKey: "segLoyal", descKey: "segLoyalDesc", icon: Heart, color: "text-rose-600 bg-rose-50 border-rose-200" },
  new: { labelKey: "segNew", descKey: "segNewDesc", icon: Sparkles, color: "text-brand-600 bg-brand-50 border-brand-200" },
  promising: { labelKey: "segPromising", descKey: "segPromisingDesc", icon: Sprout, color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  at_risk: { labelKey: "segAtRisk", descKey: "segAtRiskDesc", icon: AlertTriangle, color: "text-red-600 bg-red-50 border-red-200" },
  hibernating: { labelKey: "segHibernating", descKey: "segHibernatingDesc", icon: Moon, color: "text-slate-500 bg-slate-50 border-slate-200" },
};

const SEGMENT_ORDER = ["champions", "loyal", "new", "promising", "at_risk", "hibernating"];

export default function CustomersPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [summary, setSummary] = useState<SegmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [customers, setCustomers] = useState<SegmentCustomer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [ltSummary, setLtSummary] = useState<ValueSummary | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { sort, toggle, apply } = useSort<SegmentCustomer>();

  const sortedCustomers = useMemo(
    () =>
      apply(customers, {
        name: (c) => c.customer_name,
        phone: (c) => c.customer_phone,
        city: (c) => c.city,
        orders: (c) => c.orders,
        spent: (c) => c.total_spent,
        last: (c) => c.last_order_date,
        recency: (c) => c.recency_days,
      }),
    [customers, apply]
  );

  useEffect(() => {
    supabase.rpc("fn_rfm_summary").then(({ data }) => {
      setSummary((data as SegmentSummary[]) ?? []);
      setLoading(false);
    });
    supabase.rpc("fn_identity_summary").then(({ data }) => {
      const s = data as ValueSummary | null;
      setLtSummary(s && Number(s.people) > 0 ? s : null);
    });
  }, [supabase, reloadKey]);

  async function openSegment(segment: string) {
    setSelected(segment);
    setCustomersLoading(true);
    const { data } = await supabase.rpc("fn_rfm_customers", { p_segment: segment, p_limit: 1000 });
    setCustomers((data as SegmentCustomer[]) ?? []);
    setCustomersLoading(false);
  }

  function exportSegment() {
    if (!customers.length || !selected) return;
    downloadCsv(
      `customers-${selected}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(customers as unknown as Record<string, unknown>[])
    );
  }

  const ordered = SEGMENT_ORDER.map((key) => summary.find((s) => s.segment === key)).filter(Boolean) as SegmentSummary[];

  return (
    <div>
      <PageHeader title={t("customers")} subtitle={t("customersSubtitle")} />

      {loading ? (
        <Spinner />
      ) : ordered.length === 0 ? (
        <EmptyState message={t("noData")} />
      ) : (
        <>
          {ltSummary && <IdentityKpis s={ltSummary} />}
          {ltSummary && <LifetimeKpis s={ltSummary} />}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 mb-8">
            {ordered.map((s) => {
              const meta = SEGMENT_META[s.segment];
              if (!meta) return null;
              const Icon = meta.icon;
              return (
                <div
                  key={s.segment}
                  className={cn(
                    "card p-5 border cursor-pointer transition hover:shadow-md",
                    selected === s.segment && "ring-2 ring-brand-400"
                  )}
                  onClick={() => openSegment(s.segment)}
                >
                  <div className="flex items-start justify-between">
                    <div className={cn("rounded-lg border p-2", meta.color)}>
                      <Icon size={20} />
                    </div>
                    <div className="text-end">
                      <div className="text-2xl font-bold">{formatNumber(s.customers)}</div>
                      <div className="text-xs text-slate-500">{t("uniqueCustomers")}</div>
                    </div>
                  </div>
                  <h3 className="mt-3 font-bold">{t(meta.labelKey)}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">{t(meta.descKey)}</p>
                  <div className="mt-3 flex justify-between border-t border-slate-100 pt-2 text-xs text-slate-600">
                    <span>{t("revenue")}: <b>{formatMoney(s.total_revenue, lang)}</b></span>
                    <span>{t("avgCustomerSpend")}: <b>{formatMoney(s.avg_spend, lang)}</b></span>
                  </div>
                  <button
                    className="btn-secondary w-full mt-3 !py-1.5 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      openSegment(s.segment);
                    }}
                  >
                    {t("viewCustomers")}
                  </button>
                </div>
              );
            })}
          </div>

          {selected && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-bold">
                  {t(SEGMENT_META[selected]?.labelKey ?? "customers")} ({formatNumber(customers.length)})
                </h2>
                <button className="btn-secondary" onClick={exportSegment} disabled={!customers.length}>
                  <Download size={16} />
                  {t("exportSegment")}
                </button>
              </div>
              <div className="card overflow-x-auto">
                {customersLoading ? (
                  <Spinner />
                ) : (
                  <table className="table-base">
                    <thead>
                      <tr>
                        <SortTh label={t("customer")} k="name" sort={sort} onToggle={toggle} />
                        <SortTh label={t("phone")} k="phone" sort={sort} onToggle={toggle} />
                        <SortTh label={t("city")} k="city" sort={sort} onToggle={toggle} />
                        <SortTh label={t("orders")} k="orders" sort={sort} onToggle={toggle} />
                        <SortTh label={t("totalSpent")} k="spent" sort={sort} onToggle={toggle} />
                        <SortTh label={t("lastOrder")} k="last" sort={sort} onToggle={toggle} />
                        <SortTh label={t("recencyDays")} k="recency" sort={sort} onToggle={toggle} />
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedCustomers.map((c) => (
                        <tr key={c.customer_id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDrawerId(c.customer_id)}>
                          <td className="font-medium">{c.customer_name ?? c.customer_id}</td>
                          <td dir="ltr" className="text-slate-600">{c.customer_phone ?? "—"}</td>
                          <td>{c.city ?? "—"}</td>
                          <td className="font-semibold">{formatNumber(c.orders)}</td>
                          <td>{formatMoney(c.total_spent, lang)}</td>
                          <td className="text-xs text-slate-500">{formatDate(c.last_order_date)}</td>
                          <td>{formatNumber(c.recency_days)}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <ContactActions phone={c.customer_phone} name={c.customer_name} waReason="general" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {ltSummary ? (
            <LifetimeInsights onOpenCustomer={setDrawerId} />
          ) : (
            <div className="mt-8 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              <History size={16} className="shrink-0 mt-0.5" />
              {t("uploadStatsNudge")}
            </div>
          )}

          <MarketingAudiences neverPurchased={!!ltSummary} onOpenCustomer={setDrawerId} />

          <CustomerBrowser onOpenCustomer={setDrawerId} onChanged={() => setReloadKey((k) => k + 1)} />

          <CustomerDrawer
            customerId={drawerId}
            onClose={() => setDrawerId(null)}
            onChanged={() => setReloadKey((k) => k + 1)}
          />
        </>
      )}
    </div>
  );
}

function MarketingAudiences({ neverPurchased, onOpenCustomer }: { neverPurchased: boolean; onOpenCustomer: (id: string) => void }) {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [birthdays, setBirthdays] = useState<BirthdayRow[]>([]);
  const [loadingB, setLoadingB] = useState(true);
  const [birthMonth, setBirthMonth] = useState(new Date().getMonth() + 1);
  const [birthOrdered, setBirthOrdered] = useState<"all" | "ordered" | "never">("all");

  // Deep link from the Overview alert feed: /customers?month=8#birthdays.
  // The section loads async, so scroll once it's actually on the page
  // rather than relying on the browser's initial hash jump.
  useEffect(() => {
    const m = Number(new URLSearchParams(window.location.search).get("month"));
    if (m >= 1 && m <= 12) setBirthMonth(m);
    if (window.location.hash === "#birthdays") {
      const scroll = () => document.getElementById("birthdays")?.scrollIntoView({ behavior: "smooth", block: "start" });
      const timer = setTimeout(scroll, 350);
      return () => clearTimeout(timer);
    }
  }, []);
  const [exportingWinback, setExportingWinback] = useState(false);
  const { sort, toggle, apply } = useSort<BirthdayRow>();

  const hasOrdered = (b: BirthdayRow) => b.orders > 0 || (b.lifetime_orders ?? 0) > 0;
  const filteredBirthdays = useMemo(
    () =>
      birthOrdered === "all"
        ? birthdays
        : birthdays.filter((b) => (birthOrdered === "ordered" ? hasOrdered(b) : !hasOrdered(b))),
    [birthdays, birthOrdered]
  );

  const sortedBirthdays = useMemo(
    () =>
      apply(filteredBirthdays, {
        day: (b) => b.birth_day,
        birthdate: (b) => b.birthdate,
        name: (b) => b.name,
        phone: (b) => b.phone,
        city: (b) => b.city,
        orders: (b) => b.orders,
        spent: (b) => b.total_spent,
        last: (b) => b.last_order,
      }),
    [filteredBirthdays, apply]
  );

  useEffect(() => {
    setLoadingB(true);
    supabase.rpc("fn_birthdays", { p_month: birthMonth, p_limit: 2000 }).then(({ data }) => {
      setBirthdays((data as BirthdayRow[]) ?? []);
      setLoadingB(false);
    });
  }, [supabase, birthMonth]);

  const monthName = (m: number) =>
    new Date(2000, m - 1, 1).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { month: "long" });

  async function exportWinback() {
    setExportingWinback(true);
    const rows = await rpcAll<WinbackRow>(supabase, "fn_never_purchased", { p_limit: 50000 });
    if (rows.length) {
      downloadCsv(`never-purchased-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows as unknown as Record<string, unknown>[]));
    }
    setExportingWinback(false);
  }

  function exportBirthdays() {
    if (!filteredBirthdays.length) return;
    const suffix = birthOrdered === "all" ? "" : birthOrdered === "ordered" ? "-ordered-before" : "-never-ordered";
    downloadCsv(
      `birthdays-month-${String(birthMonth).padStart(2, "0")}${suffix}.csv`,
      toCsv(filteredBirthdays as unknown as Record<string, unknown>[])
    );
  }

  return (
    <div className="mt-8 space-y-6">
      {neverPurchased && (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-red-50 p-2 text-red-600">
                <UserX size={20} />
              </div>
              <div>
                <h3 className="font-bold">{t("winbackTitle")}</h3>
                <p className="mt-0.5 text-xs text-slate-500">{t("winbackHint")}</p>
              </div>
            </div>
            <button className="btn-primary" onClick={exportWinback} disabled={exportingWinback}>
              <Download size={16} />
              {t("exportList")}
            </button>
          </div>
        </div>
      )}

      <div className="card p-5" id="birthdays">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-pink-50 p-2 text-pink-600">
              <Cake size={20} />
            </div>
            <div>
              <h3 className="font-bold">
                {t("birthdaysTitle")} — {monthName(birthMonth)} ({formatNumber(filteredBirthdays.length)})
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">{t("birthdaysHint")}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={birthMonth}
              onChange={(e) => setBirthMonth(Number(e.target.value))}
              className="input !w-auto"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{monthName(m)}</option>
              ))}
            </select>
            <select
              value={birthOrdered}
              onChange={(e) => setBirthOrdered(e.target.value as typeof birthOrdered)}
              className="input !w-auto"
            >
              <option value="all">{t("bdFilterAll")}</option>
              <option value="ordered">{t("bdFilterOrdered")}</option>
              <option value="never">{t("bdFilterNever")}</option>
            </select>
            <button className="btn-secondary" onClick={exportBirthdays} disabled={!filteredBirthdays.length}>
              <Download size={16} />
              {t("exportList")}
            </button>
          </div>
        </div>

        {loadingB ? (
          <Spinner />
        ) : filteredBirthdays.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-500">{t("noResults")}</div>
        ) : (
          <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200">
            <table className="table-base">
              <thead>
                <tr>
                  <SortTh label={t("birthDay")} k="day" sort={sort} onToggle={toggle} />
                  <SortTh label={t("birthDate")} k="birthdate" sort={sort} onToggle={toggle} />
                  <SortTh label={t("customer")} k="name" sort={sort} onToggle={toggle} />
                  <SortTh label={t("phone")} k="phone" sort={sort} onToggle={toggle} />
                  <SortTh label={t("city")} k="city" sort={sort} onToggle={toggle} />
                  <SortTh label={t("orders")} k="orders" sort={sort} onToggle={toggle} />
                  <SortTh label={t("totalSpent")} k="spent" sort={sort} onToggle={toggle} />
                  <SortTh label={t("lastOrder")} k="last" sort={sort} onToggle={toggle} />
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sortedBirthdays.map((b) => (
                  <tr key={b.customer_id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpenCustomer(b.customer_id)}>
                    <td className="font-bold text-pink-600">{b.birth_day}</td>
                    <td className="text-xs text-slate-600" dir="ltr">{formatDate(b.birthdate)}</td>
                    <td className="font-medium">{b.name ?? b.customer_id}</td>
                    <td dir="ltr" className="text-slate-600">{b.phone ?? "—"}</td>
                    <td>{b.city ?? "—"}</td>
                    <td>{formatNumber(b.orders)}</td>
                    <td>{formatMoney(b.total_spent, lang)}</td>
                    <td className="text-xs text-slate-500">{formatDate(b.last_order)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <ContactActions phone={b.phone} email={b.email} name={b.name} waReason="birthday" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Headline counts AFTER de-duplication: the platform opens a fresh
// customer record on every guest checkout, so the raw account count is
// always higher than the number of real people.
function IdentityKpis({ s }: { s: ValueSummary }) {
  const { t } = useLang();
  const people = Number(s.people);
  const buyers = Number(s.buyers);
  const dupes = Number(s.duplicate_accounts);
  const hidden = Number(s.repeat_hidden_by_dupes);
  return (
    <div className="mb-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card p-4 border-s-4 border-s-brand-500">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("realCustomers")}</div>
          <div className="mt-1 text-2xl font-bold">{formatNumber(people)}</div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            {formatNumber(Number(s.accounts))} {t("accountsOnPlatform")}
          </div>
        </div>
        <div className="card p-4 border-s-4 border-s-violet-500">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("mergedDuplicates")}</div>
          <div className="mt-1 text-2xl font-bold">{formatNumber(dupes)}</div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            {formatNumber(Number(s.merged_people))} {t("peopleAffected")}
          </div>
        </div>
        <div className="card p-4 border-s-4 border-s-emerald-500">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("buyersCount")}</div>
          <div className="mt-1 text-2xl font-bold">{formatNumber(buyers)}</div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            {t("registrationToBuyer")}: {people > 0 ? ((buyers / people) * 100).toFixed(1) : "0"}%
          </div>
        </div>
        <div className="card p-4 border-s-4 border-s-red-500">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("neverPurchased")}</div>
          <div className="mt-1 text-2xl font-bold">{formatNumber(Number(s.never_ordered))}</div>
        </div>
      </div>
      {hidden > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          <Users2 size={16} className="mt-0.5 shrink-0" />
          <span>
            {t("hiddenRepeatBanner")
              .replace("{hidden}", formatNumber(hidden))
              .replace("{before}", formatNumber(Number(s.repeat_buyers_unmerged)))
              .replace("{after}", formatNumber(Number(s.repeat_buyers)))}
          </span>
        </div>
      )}
    </div>
  );
}

function LifetimeKpis({ s }: { s: ValueSummary }) {
  const { t, lang } = useLang();
  const repeatRate = Number(s.delivered_buyers) > 0 ? (Number(s.repeat_buyers) / Number(s.delivered_buyers)) * 100 : 0;
  const cancelRate = Number(s.lifetime_orders_total) > 0 ? (Number(s.lifetime_canceled_total) / Number(s.lifetime_orders_total)) * 100 : 0;
  return (
    <div className="mb-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card p-4 border-s-4 border-s-emerald-600">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("lifetimeRevenue")}</div>
          <div className="mt-1 text-2xl font-bold">{formatMoney(s.delivered_amount_total, lang)}</div>
          <div className="mt-0.5 text-[11px] text-slate-400">{formatNumber(s.lifetime_delivered_total)} {t("deliveredOrdersLbl")}</div>
        </div>
        <div className="card p-4 border-s-4 border-s-brand-600">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("avgLtv")}</div>
          <div className="mt-1 text-2xl font-bold">{formatMoney(s.avg_ltv, lang)}</div>
          <div className="mt-0.5 text-[11px] text-slate-400">{formatNumber(s.delivered_buyers)} {t("deliveredBuyersLbl")}</div>
        </div>
        <div className="card p-4 border-s-4 border-s-violet-500">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("repeatRate")}</div>
          <div className="mt-1 text-2xl font-bold">{repeatRate.toFixed(1)}%</div>
          <div className="mt-0.5 text-[11px] text-slate-400">{formatNumber(s.repeat_buyers)} {t("repeatBuyersLbl")}</div>
        </div>
        <div className="card p-4 border-s-4 border-s-red-500">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("canceledRevenue")}</div>
          <div className="mt-1 text-2xl font-bold">{formatMoney(s.canceled_amount_total, lang)}</div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            {formatNumber(s.lifetime_canceled_total)} {t("canceledOrdersLbl")} · {cancelRate.toFixed(1)}%
          </div>
        </div>
      </div>
      {s.stats_updated_at && (
        <div className="mt-2 text-[11px] text-slate-400">
          {t("statsUpdatedAt")}: {formatDate(s.stats_updated_at)}
        </div>
      )}
    </div>
  );
}

function LifetimeInsights({ onOpenCustomer }: { onOpenCustomer: (id: string) => void }) {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [vips, setVips] = useState<TopCustomer[]>([]);
  const [cities, setCities] = useState<CityStat[]>([]);
  const [stuck, setStuck] = useState<StuckRow[]>([]);
  const [churned, setChurned] = useState<ChurnedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const vipSort = useSort<TopCustomer>();
  const stuckSort = useSort<StuckRow>();

  useEffect(() => {
    (async () => {
      const [v, c, st, ch] = await Promise.all([
        supabase.rpc("fn_top_lifetime_customers", { p_limit: 100 }),
        supabase.rpc("fn_lifetime_city_stats", { p_limit: 40 }),
        supabase.rpc("fn_stuck_last_orders", { p_limit: 2000 }),
        rpcAll<ChurnedRow>(supabase, "fn_churned_vips", { p_months: 6, p_min_delivered: 2, p_limit: 20000 }),
      ]);
      setVips((v.data as TopCustomer[]) ?? []);
      setCities((c.data as CityStat[]) ?? []);
      setStuck((st.data as StuckRow[]) ?? []);
      setChurned(ch);
      setLoading(false);
    })();
  }, [supabase]);

  const sortedVips = useMemo(
    () =>
      vipSort.apply(vips, {
        name: (r) => r.name,
        city: (r) => r.city,
        orders: (r) => r.lifetime_orders,
        delivered: (r) => r.lifetime_delivered,
        canceled: (r) => r.lifetime_canceled,
        spent: (r) => r.lifetime_delivered_amount,
        last: (r) => r.last_order_at,
      }),
    [vips, vipSort]
  );

  const sortedStuck = useMemo(
    () =>
      stuckSort.apply(stuck, {
        name: (r) => r.name,
        city: (r) => r.city,
        state: (r) => r.last_order_state,
        last: (r) => r.last_order_at,
        orders: (r) => r.lifetime_orders,
        amount: (r) => r.lifetime_amount,
      }),
    [stuck, stuckSort]
  );

  function exportRows(name: string, rows: unknown[]) {
    if (!rows.length) return;
    downloadCsv(`${name}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows as Record<string, unknown>[]));
  }

  if (loading) {
    return (
      <div className="mt-8">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      {/* VIP top customers */}
      <div className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-amber-50 p-2 text-amber-600">
              <Trophy size={20} />
            </div>
            <div>
              <h3 className="font-bold">{t("topCustomers")} ({formatNumber(vips.length)})</h3>
              <p className="mt-0.5 text-xs text-slate-500">{t("topCustomersHint")}</p>
            </div>
          </div>
          <button className="btn-secondary" onClick={() => exportRows("vip-customers", vips)} disabled={!vips.length}>
            <Download size={16} />
            {t("exportList")}
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200">
          <table className="table-base">
            <thead>
              <tr>
                <SortTh label={t("customer")} k="name" sort={vipSort.sort} onToggle={vipSort.toggle} />
                <th>{t("phone")}</th>
                <SortTh label={t("city")} k="city" sort={vipSort.sort} onToggle={vipSort.toggle} />
                <SortTh label={t("ltOrders")} k="orders" sort={vipSort.sort} onToggle={vipSort.toggle} />
                <SortTh label={t("deliveredCol")} k="delivered" sort={vipSort.sort} onToggle={vipSort.toggle} />
                <SortTh label={t("canceledCol")} k="canceled" sort={vipSort.sort} onToggle={vipSort.toggle} />
                <SortTh label={t("totalSpent")} k="spent" sort={vipSort.sort} onToggle={vipSort.toggle} />
                <SortTh label={t("lastOrder")} k="last" sort={vipSort.sort} onToggle={vipSort.toggle} />
                <th>{t("lastState")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedVips.map((c, i) => (
                <tr key={c.customer_id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpenCustomer(c.customer_id)}>
                  <td className="font-medium">
                    {i < 3 && <span className="me-1">{["🥇", "🥈", "🥉"][i]}</span>}
                    {c.name ?? c.customer_id}
                  </td>
                  <td dir="ltr" className="text-slate-600">{c.phone ?? "—"}</td>
                  <td>{c.city ?? "—"}</td>
                  <td className="font-semibold">{formatNumber(c.lifetime_orders)}</td>
                  <td className="text-emerald-700">{formatNumber(c.lifetime_delivered)}</td>
                  <td className="text-red-600">{formatNumber(c.lifetime_canceled)}</td>
                  <td className="font-semibold">{formatMoney(c.lifetime_delivered_amount, lang)}</td>
                  <td className="text-xs text-slate-500" dir="ltr">{formatDate(c.last_order_at)}</td>
                  <td className="text-xs">{c.last_order_state ?? "—"}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <ContactActions phone={c.phone} email={c.email} name={c.name} waReason="general" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cities + churned VIP winback */}
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="card p-5">
          <div className="mb-4 flex items-start gap-3">
            <div className="rounded-lg bg-sky-50 p-2 text-sky-600">
              <MapPin size={20} />
            </div>
            <div>
              <h3 className="font-bold">{t("cityBreakdown")}</h3>
              <p className="mt-0.5 text-xs text-slate-500">{t("cityBreakdownHint")}</p>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t("city")}</th>
                  <th>{t("customers")}</th>
                  <th>{t("deliveredCol")}</th>
                  <th>{t("revenue")}</th>
                  <th>{t("avgLtv")}</th>
                  <th>{t("canceledCol")}</th>
                </tr>
              </thead>
              <tbody>
                {cities.map((c) => (
                  <tr key={c.city}>
                    <td className="font-medium">{c.city}</td>
                    <td>{formatNumber(c.customers)}</td>
                    <td className="text-emerald-700">{formatNumber(c.delivered_orders)}</td>
                    <td className="font-semibold">{formatMoney(c.delivered_amount, lang)}</td>
                    <td>{formatMoney(c.avg_ltv, lang)}</td>
                    <td className="text-red-600 text-xs">
                      {formatNumber(c.canceled_orders)} · {formatMoney(c.canceled_amount, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-violet-50 p-2 text-violet-600">
                  <RotateCcw size={20} />
                </div>
                <div>
                  <h3 className="font-bold">{t("churnedVips")} ({formatNumber(churned.length)})</h3>
                  <p className="mt-0.5 text-xs text-slate-500">{t("churnedVipsHint")}</p>
                </div>
              </div>
              <button className="btn-primary" onClick={() => exportRows("churned-vips", churned)} disabled={!churned.length}>
                <Download size={16} />
                {t("exportList")}
              </button>
            </div>
          </div>

          <div className="card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-orange-50 p-2 text-orange-600">
                  <PackageSearch size={20} />
                </div>
                <div>
                  <h3 className="font-bold">{t("stuckOrders")} ({formatNumber(stuck.length)})</h3>
                  <p className="mt-0.5 text-xs text-slate-500">{t("stuckOrdersHint")}</p>
                </div>
              </div>
              <button className="btn-secondary" onClick={() => exportRows("last-order-followups", stuck)} disabled={!stuck.length}>
                <Download size={16} />
                {t("exportList")}
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200">
              <table className="table-base">
                <thead>
                  <tr>
                    <SortTh label={t("customer")} k="name" sort={stuckSort.sort} onToggle={stuckSort.toggle} />
                    <th>{t("phone")}</th>
                    <SortTh label={t("lastState")} k="state" sort={stuckSort.sort} onToggle={stuckSort.toggle} />
                    <SortTh label={t("lastOrder")} k="last" sort={stuckSort.sort} onToggle={stuckSort.toggle} />
                    <SortTh label={t("ltOrders")} k="orders" sort={stuckSort.sort} onToggle={stuckSort.toggle} />
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedStuck.slice(0, 300).map((r) => (
                    <tr key={r.customer_id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpenCustomer(r.customer_id)}>
                      <td className="font-medium">{r.name ?? r.customer_id}</td>
                      <td dir="ltr" className="text-slate-600">{r.phone ?? "—"}</td>
                      <td>
                        <span className="inline-block rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">
                          {r.last_order_state}
                        </span>
                      </td>
                      <td className="text-xs text-slate-500" dir="ltr">{formatDate(r.last_order_at)}</td>
                      <td>{formatNumber(r.lifetime_orders)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <ContactActions phone={r.phone} email={r.email} name={r.name} waReason="general" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
