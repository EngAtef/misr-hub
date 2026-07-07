"use client";

import { useEffect, useMemo, useState } from "react";
import { Crown, Heart, Sparkles, Sprout, AlertTriangle, Moon, Download, Cake, UserX } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { PageHeader, Spinner, EmptyState, SortTh, useSort } from "@/components/ui";
import { formatMoney, formatNumber, formatDate, toCsv, downloadCsv, cn, sanitizeSearch } from "@/lib/utils";
import { ContactActions } from "@/components/contact-actions";

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
  const [registered, setRegistered] = useState<number | null>(null);
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
    supabase
      .from("customers")
      .select("customer_id", { count: "exact", head: true })
      .then(({ count }) => setRegistered(count ?? null));
  }, [supabase]);

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
          {registered !== null && registered > 0 && (() => {
            const buyers = summary.reduce((s, x) => s + Number(x.customers), 0);
            return (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4 mb-6">
                <div className="card p-4 border-s-4 border-s-brand-500">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("registeredCustomers")}</div>
                  <div className="mt-1 text-2xl font-bold">{formatNumber(registered)}</div>
                </div>
                <div className="card p-4 border-s-4 border-s-emerald-500">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("buyersCount")}</div>
                  <div className="mt-1 text-2xl font-bold">{formatNumber(buyers)}</div>
                </div>
                <div className="card p-4 border-s-4 border-s-amber-500">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("registrationToBuyer")}</div>
                  <div className="mt-1 text-2xl font-bold">{((buyers / registered) * 100).toFixed(1)}%</div>
                </div>
                <div className="card p-4 border-s-4 border-s-red-500">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("neverPurchased")}</div>
                  <div className="mt-1 text-2xl font-bold">{formatNumber(Math.max(registered - buyers, 0))}</div>
                </div>
              </div>
            );
          })()}
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
                        <tr key={c.customer_id}>
                          <td className="font-medium">{c.customer_name ?? c.customer_id}</td>
                          <td dir="ltr" className="text-slate-600">{c.customer_phone ?? "—"}</td>
                          <td>{c.city ?? "—"}</td>
                          <td className="font-semibold">{formatNumber(c.orders)}</td>
                          <td>{formatMoney(c.total_spent, lang)}</td>
                          <td className="text-xs text-slate-500">{formatDate(c.last_order_date)}</td>
                          <td>{formatNumber(c.recency_days)}</td>
                          <td>
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

          <MarketingAudiences neverPurchased={registered !== null} />

          <AllCustomersBrowser />
        </>
      )}
    </div>
  );
}

function AllCustomersBrowser() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<
    { customer_id: string; name: string | null; phone: string | null; email: string | null; city: string | null; birthdate: string | null; joined_at: string | null; total_orders: number | null }[]
  >([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const PAGE = 25;
  const { sort, toggle } = useSort<never>();

  function onSort(key: string) {
    toggle(key);
    setPage(0);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = supabase
        .from("customers")
        .select("customer_id, name, phone, email, city, birthdate, joined_at, total_orders", { count: "exact" });
      if (search) {
        const s = sanitizeSearch(search);
        if (s) q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%`);
      }
      const { data, count } = await q
        .order(sort?.key ?? "joined_at", { ascending: sort?.dir === "asc", nullsFirst: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (cancelled) return;
      setRows((data as typeof rows) ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, search, page, supabase, sort]);

  if (!open) {
    return (
      <div className="mt-8">
        <button className="btn-primary" onClick={() => setOpen(true)}>
          {t("viewAllCustomers")}
        </button>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">
          {t("allCustomers")} ({formatNumber(total)})
        </h2>
        <span className="text-[11px] text-slate-400">{t("lastActionNote")}</span>
      </div>
      <form
        className="mb-3"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setSearch(searchInput.trim());
        }}
      >
        <input className="input max-w-md" placeholder={t("searchCustomersPh")} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
      </form>
      <div className="card overflow-x-auto">
        {loading ? (
          <Spinner />
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <SortTh label={t("customer")} k="name" sort={sort} onToggle={onSort} />
                <SortTh label={t("phone")} k="phone" sort={sort} onToggle={onSort} />
                <SortTh label={t("email")} k="email" sort={sort} onToggle={onSort} />
                <SortTh label={t("city")} k="city" sort={sort} onToggle={onSort} />
                <SortTh label={t("birthDate")} k="birthdate" sort={sort} onToggle={onSort} />
                <SortTh label={t("registeredAt")} k="joined_at" sort={sort} onToggle={onSort} />
                <SortTh label={t("orders")} k="total_orders" sort={sort} onToggle={onSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.customer_id}>
                  <td className="font-medium">{c.name ?? c.customer_id}</td>
                  <td dir="ltr" className="text-slate-600">{c.phone ?? "—"}</td>
                  <td dir="ltr" className="text-xs text-slate-500">{c.email ?? "—"}</td>
                  <td>{c.city ?? "—"}</td>
                  <td dir="ltr" className="text-xs">{formatDate(c.birthdate)}</td>
                  <td dir="ltr" className="text-xs text-slate-500">{formatDate(c.joined_at)}</td>
                  <td className="font-semibold">{c.total_orders ?? 0}</td>
                  <td>
                    <ContactActions phone={c.phone} email={c.email} name={c.name} waReason="general" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
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
    </div>
  );
}

function MarketingAudiences({ neverPurchased }: { neverPurchased: boolean }) {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [birthdays, setBirthdays] = useState<BirthdayRow[]>([]);
  const [loadingB, setLoadingB] = useState(true);
  const [exportingWinback, setExportingWinback] = useState(false);
  const { sort, toggle, apply } = useSort<BirthdayRow>();

  const sortedBirthdays = useMemo(
    () =>
      apply(birthdays, {
        day: (b) => b.birth_day,
        birthdate: (b) => b.birthdate,
        name: (b) => b.name,
        phone: (b) => b.phone,
        city: (b) => b.city,
        orders: (b) => b.orders,
        spent: (b) => b.total_spent,
        last: (b) => b.last_order,
      }),
    [birthdays, apply]
  );

  useEffect(() => {
    supabase.rpc("fn_birthdays", { p_limit: 2000 }).then(({ data }) => {
      setBirthdays((data as BirthdayRow[]) ?? []);
      setLoadingB(false);
    });
  }, [supabase]);

  async function exportWinback() {
    setExportingWinback(true);
    const { data } = await supabase.rpc("fn_never_purchased", { p_limit: 25000 });
    const rows = (data as WinbackRow[]) ?? [];
    if (rows.length) {
      downloadCsv(`never-purchased-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows as unknown as Record<string, unknown>[]));
    }
    setExportingWinback(false);
  }

  function exportBirthdays() {
    if (!birthdays.length) return;
    downloadCsv(`birthdays-${new Date().toISOString().slice(0, 7)}.csv`, toCsv(birthdays as unknown as Record<string, unknown>[]));
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

      <div className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-pink-50 p-2 text-pink-600">
              <Cake size={20} />
            </div>
            <div>
              <h3 className="font-bold">
                {t("birthdaysTitle")} ({formatNumber(birthdays.length)})
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">{t("birthdaysHint")}</p>
            </div>
          </div>
          <button className="btn-secondary" onClick={exportBirthdays} disabled={!birthdays.length}>
            <Download size={16} />
            {t("exportList")}
          </button>
        </div>

        {loadingB ? (
          <Spinner />
        ) : birthdays.length === 0 ? (
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
                  <tr key={b.customer_id}>
                    <td className="font-bold text-pink-600">{b.birth_day}</td>
                    <td className="text-xs text-slate-600" dir="ltr">{formatDate(b.birthdate)}</td>
                    <td className="font-medium">{b.name ?? b.customer_id}</td>
                    <td dir="ltr" className="text-slate-600">{b.phone ?? "—"}</td>
                    <td>{b.city ?? "—"}</td>
                    <td>{formatNumber(b.orders)}</td>
                    <td>{formatMoney(b.total_spent, lang)}</td>
                    <td className="text-xs text-slate-500">{formatDate(b.last_order)}</td>
                    <td>
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
