"use client";

import { useEffect, useMemo, useState } from "react";
import { X, BookOpen, Download, Package } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { Spinner, EmptyState } from "@/components/ui";
import { formatMoney, formatNumber, formatDate, toCsv, downloadCsv, cn } from "@/lib/utils";

// Everything the uploaded catalog file carried for this SKU.
interface ProductDetail {
  sku: string;
  name: string | null;
  english_name: string | null;
  price: number | null;
  section: string | null;
  category: string | null;
  language: string | null;
  age: string | null;
  series: string | null;
  publisher: string | null;
  author: string | null;
  other_authors: string | null;
  translated_from: string | null;
  book_type: string | null;
  cover_type: string | null;
  paper_type: string | null;
  pages: string | null;
  dimensions: string | null;
  semester: string | null;
  link: string | null;
  release_date: string | null;
  description: string | null;
  image: string | null;
  barcode: string | null;
  vendor: string | null;
  attributes: Record<string, string> | null;
  updated_at: string | null;
}

interface PurchaseRow {
  order_number: string;
  order_date: string | null;
  order_status: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  city: string | null;
  area: string | null;
  product_name: string | null;
  sku: string | null;
  units: number | null;
  unit_price: number | null;
  book_amount: number | null;
  order_total: number | null;
  payment_method: string | null;
}

function statusTone(status: string | null): string {
  if (!status) return "bg-slate-100 text-slate-600";
  if (status === "Delivered") return "bg-emerald-100 text-emerald-800";
  if (["Cancelled", "Canceled"].includes(status)) return "bg-red-100 text-red-700";
  if (status.toLowerCase().includes("return")) return "bg-orange-100 text-orange-800";
  return "bg-amber-100 text-amber-800";
}

/**
 * Lifetime order history for one book. Deliberately unbounded by the
 * page's date filter: a book with 0 stock whose only orders are from
 * last year must still show its buyers here.
 */
export function ProductDrawer({
  sku,
  name,
  stock,
  onClose,
}: {
  sku: string | null;
  name?: string | null;
  stock?: number | null;
  onClose: () => void;
}) {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sku) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setRows([]);
      setDetail(null);
      const [{ data }, { data: prod }] = await Promise.all([
        supabase.rpc("fn_sku_purchasers", {
          p_sku: sku,
          p_keyword: null,
          p_from: null,
          p_to: null,
          p_limit: 10000,
        }),
        supabase.from("products").select("*").eq("sku", sku).maybeSingle(),
      ]);
      if (cancelled) return;
      setRows(((data as PurchaseRow[]) ?? []).filter((r) => r.sku === sku || !r.sku));
      setDetail((prod as ProductDetail) ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [sku, supabase]);

  const totals = useMemo(() => {
    const live = rows.filter((r) => !["Cancelled", "Canceled"].includes(r.order_status ?? ""));
    return {
      orders: live.length,
      units: live.reduce((s, r) => s + Number(r.units ?? 0), 0),
      revenue: live.reduce((s, r) => s + Number(r.book_amount ?? 0), 0),
      cancelled: rows.length - live.length,
      customers: new Set(live.map((r) => r.customer_id ?? r.customer_phone ?? r.order_number)).size,
    };
  }, [rows]);

  if (!sku) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="absolute inset-y-0 end-0 flex w-full max-w-3xl flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-brand-50 p-2 text-brand-600">
              <BookOpen size={20} />
            </div>
            <div>
              <h2 className="font-bold text-lg leading-tight">{name ?? sku}</h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span dir="ltr" className="font-mono">{sku}</span>
                {stock !== null && stock !== undefined && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold",
                      stock > 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
                    )}
                  >
                    <Package size={11} />
                    {t("stock")}: {formatNumber(stock)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary !px-2.5 !py-1.5 text-xs"
              disabled={!rows.length}
              onClick={() => downloadCsv(`buyers-${sku}.csv`, toCsv(rows as unknown as Record<string, unknown>[]))}
            >
              <Download size={14} />
              {t("exportCsv")}
            </button>
            <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label={t("close")}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Everything the uploaded catalog file holds for this book */}
          {detail && (
            <div className="card flex gap-4 p-4">
              {detail.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={detail.image}
                  alt=""
                  className="h-36 w-24 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
              <div className="min-w-0 flex-1">
                {detail.price !== null && (
                  <div className="mb-2 text-lg font-bold text-brand-700">{formatMoney(Number(detail.price), lang)}</div>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <Field label={t("fldAuthor")} value={detail.author ?? detail.other_authors} />
                  <Field label={t("fldPublisher")} value={detail.publisher ?? detail.vendor} />
                  <Field label={t("fldLanguage")} value={detail.language} />
                  <Field label={t("fldAge")} value={detail.age} />
                  <Field label={t("fldSeries")} value={detail.series} />
                  <Field label={t("fldSection")} value={detail.section ?? detail.category} />
                  <Field label={t("fldReleaseDate")} value={detail.release_date} />
                  <Field label={t("fldBarcode")} value={detail.barcode} ltr />
                  <Field label={t("fldPages")} value={detail.pages} />
                  <Field label={t("fldDimensions")} value={detail.dimensions} />
                  <Field label={t("fldBookType")} value={detail.book_type} />
                  <Field label={t("fldCoverType")} value={detail.cover_type} />
                </div>
                {detail.attributes && Object.keys(detail.attributes).length > 0 && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer font-semibold text-slate-500 hover:text-brand-700">{t("allUploadedFields")}</summary>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                      {Object.entries(detail.attributes).map(([k, v]) => (
                        <div key={k} className="flex gap-1.5">
                          <span className="shrink-0 text-slate-400">{k}:</span>
                          <span className="min-w-0 break-words text-slate-700">{v}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>
          )}
          {!loading && !detail && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{t("noCatalogDetail")}</div>
          )}

          <p className="text-xs text-slate-500">{t("orderHistoryHint")}</p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t("ltOrders")} value={formatNumber(totals.orders)} />
            <Stat label={t("ltUnits")} value={formatNumber(totals.units)} />
            <Stat label={t("ltRevenue")} value={formatMoney(totals.revenue, lang)} />
            <Stat label={t("uniqueCustomers")} value={formatNumber(totals.customers)} />
          </div>
          {totals.cancelled > 0 && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {t("cancelled")}: {formatNumber(totals.cancelled)}
            </div>
          )}

          {loading ? (
            <Spinner />
          ) : rows.length === 0 ? (
            <EmptyState message={t("noSalesYet")} />
          ) : (
            <div className="card overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{t("date")}</th>
                    <th>{t("orderNumber")}</th>
                    <th>{t("status")}</th>
                    <th>{t("customer")}</th>
                    <th>{t("phone")}</th>
                    <th>{t("city")}</th>
                    <th>{t("qty")}</th>
                    <th>{t("unitPriceCol")}</th>
                    <th>{t("amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.order_number}>
                      <td className="whitespace-nowrap text-xs text-slate-500">{formatDate(r.order_date)}</td>
                      <td dir="ltr" className="font-mono text-xs">
                        {/* jumps to Orders filtered on this order, where the
                            full line-by-line modal lives */}
                        <a
                          href={`/orders?q=${encodeURIComponent(r.order_number)}`}
                          className="text-brand-700 hover:underline"
                          title={t("openInOrders")}
                        >
                          {r.order_number}
                        </a>
                      </td>
                      <td>
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", statusTone(r.order_status))}>
                          {r.order_status ?? "—"}
                        </span>
                      </td>
                      <td className="!whitespace-normal max-w-[12rem] font-medium">{r.customer_name ?? "—"}</td>
                      <td dir="ltr" className="font-mono text-xs text-slate-500">{r.customer_phone ?? "—"}</td>
                      <td className="text-xs">{r.city ?? "—"}</td>
                      <td className="font-semibold">{formatNumber(Number(r.units ?? 0))}</td>
                      <td className="text-xs text-slate-500">
                        {r.unit_price === null || r.unit_price === undefined ? "—" : formatMoney(Number(r.unit_price), lang)}
                      </td>
                      <td>{formatMoney(Number(r.book_amount ?? 0), lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, ltr }: { label: string; value: string | null | undefined; ltr?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex gap-1.5">
      <span className="shrink-0 text-slate-400">{label}:</span>
      <span className="min-w-0 break-words font-medium text-slate-700" dir={ltr ? "ltr" : undefined}>
        {value}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className="mt-0.5 font-bold text-slate-900" dir="ltr">{value}</div>
    </div>
  );
}
