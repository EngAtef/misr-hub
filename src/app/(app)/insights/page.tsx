"use client";

import { useMemo } from "react";
import { Megaphone, TrendingUp, Package, Share2, Truck, AlertTriangle } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { useDateRange, DateRangeFilter } from "@/components/date-range";
import { useRpc, rangeParams } from "@/lib/use-analytics";
import { PageHeader, Spinner, StatusBadge, EmptyState } from "@/components/ui";
import { formatMoney, formatNumber, formatPercent, cn } from "@/lib/utils";
import { type FollowUpReason } from "@/lib/whatsapp";
import { ContactActions } from "@/components/contact-actions";
import type { Kpis, BreakdownRow } from "@/lib/types";

interface Insight {
  category: "marketing" | "revenue" | "stock" | "ads" | "ops";
  severity: "high" | "medium" | "info";
  title: { ar: string; en: string };
  body: { ar: string; en: string };
}

interface CustomerInsights {
  total_customers: number;
  repeat_customers: number;
  avg_orders_per_customer: number;
  avg_spend_per_customer: number;
}

interface AttentionOrder {
  order_number: string;
  order_date: string;
  order_status: string;
  customer_name: string | null;
  customer_phone: string | null;
  city: string | null;
  total_order_amount: number | null;
  days_open: number;
  reason: string;
}

const CATEGORY_META = {
  marketing: { icon: Megaphone, color: "text-fuchsia-600 bg-fuchsia-50" },
  revenue: { icon: TrendingUp, color: "text-emerald-600 bg-emerald-50" },
  stock: { icon: Package, color: "text-blue-600 bg-blue-50" },
  ads: { icon: Share2, color: "text-amber-600 bg-amber-50" },
  ops: { icon: Truck, color: "text-slate-600 bg-slate-100" },
} as const;

export default function InsightsPage() {
  const { t, lang } = useLang();
  const { preset, setPreset, range, setRange } = useDateRange("90d");
  const params = rangeParams(range);
  const deps = [range.from, range.to];

  const kpis = useRpc<Kpis>("fn_kpis", params, deps);
  const byCity = useRpc<BreakdownRow[]>("fn_breakdown", { p_dim: "city", ...params, p_limit: 30 }, deps);
  const bySource = useRpc<BreakdownRow[]>("fn_breakdown", { p_dim: "source", ...params, p_limit: 10 }, deps);
  const byPromo = useRpc<BreakdownRow[]>("fn_breakdown", { p_dim: "applied_promotion", ...params, p_limit: 10 }, deps);
  const topProducts = useRpc<{ product_name: string; sku: string; quantity: number; revenue: number }[]>(
    "fn_top_products", { ...params, p_limit: 10 }, deps
  );
  const customers = useRpc<CustomerInsights>("fn_customer_insights", params, deps);
  const attention = useRpc<AttentionOrder[]>("fn_attention_orders", { p_limit: 50 }, []);

  const insights = useMemo<Insight[]>(() => {
    const out: Insight[] = [];
    const k = kpis.data;
    const c = customers.data;
    if (!k || k.total_orders === 0) return out;

    const cities = byCity.data ?? [];
    const sources = bySource.data ?? [];
    const promos = byPromo.data ?? [];
    const products = topProducts.data ?? [];

    // --- Marketing ---
    if (c && c.total_customers > 50) {
      const repeatRate = c.repeat_customers / c.total_customers;
      if (repeatRate < 0.25) {
        out.push({
          category: "marketing",
          severity: "high",
          title: { ar: "نسبة العملاء المتكررين منخفضة", en: "Low repeat-customer rate" },
          body: {
            ar: `فقط ${(repeatRate * 100).toFixed(1)}% من عملائك (${formatNumber(c.repeat_customers)} من ${formatNumber(c.total_customers)}) اشتروا أكثر من مرة. أطلق حملة إعادة استهداف عبر SMS أو واتساب أو البريد للعملاء السابقين بكود خصم — إعادة تنشيط عميل قديم أرخص 5 مرات من اكتساب عميل جديد.`,
            en: `Only ${(repeatRate * 100).toFixed(1)}% of your customers (${formatNumber(c.repeat_customers)} of ${formatNumber(c.total_customers)}) bought more than once. Launch an SMS/WhatsApp/email win-back campaign with a promo code — reactivating an old customer costs ~5x less than acquiring a new one.`,
          },
        });
      } else {
        out.push({
          category: "marketing",
          severity: "info",
          title: { ar: "قاعدة عملاء متكررين جيدة", en: "Healthy repeat-customer base" },
          body: {
            ar: `${(repeatRate * 100).toFixed(1)}% من عملائك يشترون بشكل متكرر. فكّر في برنامج ولاء بنقاط لرفع متوسط عدد الطلبات (${formatNumber(c.avg_orders_per_customer)} حالياً).`,
            en: `${(repeatRate * 100).toFixed(1)}% of customers buy repeatedly. Consider a points-based loyalty program to raise average orders per customer (currently ${formatNumber(c.avg_orders_per_customer)}).`,
          },
        });
      }
    }

    const promoOrders = promos.filter((p) => p.label !== "(none)").reduce((s, p) => s + Number(p.orders), 0);
    if (promoOrders / k.total_orders < 0.1) {
      out.push({
        category: "marketing",
        severity: "medium",
        title: { ar: "التسويق غير قابل للقياس", en: "Marketing is not measurable" },
        body: {
          ar: `أقل من 10% من الطلبات مرتبطة بكود خصم أو حملة. بدون أكواد لكل قناة (فيسبوك، انستجرام، واتساب...) لا يمكن معرفة أي قناة تربح. أنشئ حملات بأكواد مميزة من صفحة "الحملات" وتتبع العائد تلقائياً.`,
          en: `Less than 10% of orders carry a promo code or campaign id. Without per-channel codes (Facebook, Instagram, WhatsApp...) you can't tell which channel makes money. Create campaigns with unique codes in the Campaigns page and ROI is tracked automatically.`,
        },
      });
    }

    // --- Revenue ---
    const codShare = k.cod_orders / k.total_orders;
    if (codShare > 0.7) {
      out.push({
        category: "revenue",
        severity: "high",
        title: { ar: "اعتماد مرتفع على الدفع عند الاستلام", en: "Heavy reliance on Cash on Delivery" },
        body: {
          ar: `${(codShare * 100).toFixed(0)}% من الطلبات دفع عند الاستلام (${formatMoney(k.cod_amount, "ar")}). الدفع عند الاستلام يرفع نسب الرفض والمرتجعات ورسوم التحصيل. جرّب خصم 5-10 جنيه أو شحن مجاني للدفع الإلكتروني المسبق.`,
          en: `${(codShare * 100).toFixed(0)}% of orders are COD (${formatMoney(k.cod_amount, "en")}). COD inflates rejection rates, returns, and collection fees. Try a small discount or free shipping incentive for prepaid online payment.`,
        },
      });
    }

    const aov = k.avg_order_value;
    out.push({
      category: "revenue",
      severity: "info",
      title: { ar: "ارفع متوسط قيمة الطلب", en: "Raise average order value" },
      body: {
        ar: `متوسط قيمة الطلب ${formatMoney(aov, "ar")}. ضع حد الشحن المجاني عند ${formatMoney(Math.round((aov * 1.3) / 10) * 10, "ar")} تقريباً (130% من المتوسط) وأظهر "أضف بمبلغ X للشحن المجاني" في السلة — أثبتت رفع المتوسط 15-25%.`,
        en: `AOV is ${formatMoney(aov, "en")}. Set your free-shipping threshold near ${formatMoney(Math.round((aov * 1.3) / 10) * 10, "en")} (~130% of AOV) and show "add X for free shipping" in the cart — typically lifts AOV 15-25%.`,
      },
    });

    const cancelRate = k.cancelled_orders / k.total_orders;
    const returnRate = k.returned_orders / k.total_orders;
    if (cancelRate + returnRate > 0.08) {
      out.push({
        category: "revenue",
        severity: "high",
        title: { ar: "إيراد مفقود في الإلغاءات والمرتجعات", en: "Revenue leaking to cancellations & returns" },
        body: {
          ar: `${formatPercent(k.cancelled_orders + k.returned_orders, k.total_orders)} من الطلبات تُلغى أو تُرجع (${formatNumber(k.cancelled_orders + k.returned_orders)} طلب). راجع تبويب "الإلغاء والمرتجعات" لأهم الأسباب — تأكيد الطلب بمكالمة أو واتساب قبل الشحن يقلل الرفض بشكل ملحوظ.`,
          en: `${formatPercent(k.cancelled_orders + k.returned_orders, k.total_orders)} of orders get cancelled or returned (${formatNumber(k.cancelled_orders + k.returned_orders)} orders). Check the Returns tab for top reasons — confirming orders via call/WhatsApp before shipping measurably cuts rejections.`,
        },
      });
    }

    // --- Stock ---
    if (products.length >= 5) {
      const totalQty = products.reduce((s, p) => s + Number(p.quantity), 0);
      const top3 = products.slice(0, 3);
      out.push({
        category: "stock",
        severity: "medium",
        title: { ar: "أمّن مخزون الأكثر مبيعاً", en: "Secure stock of your best sellers" },
        body: {
          ar: `أكثر 3 منتجات مبيعاً (${top3.map((p) => `"${p.product_name.slice(0, 30)}"`).join("، ")}) تمثل ${formatPercent(top3.reduce((s, p) => s + Number(p.quantity), 0), totalQty)} من مبيعات أفضل 10 منتجات. نفاد مخزونها = خسارة مباشرة. راقبها أسبوعياً وأمّن إعادة الطلب مبكراً.`,
          en: `Your top 3 products (${top3.map((p) => `"${p.product_name.slice(0, 30)}"`).join(", ")}) account for ${formatPercent(top3.reduce((s, p) => s + Number(p.quantity), 0), totalQty)} of top-10 volume. A stock-out there is direct lost revenue. Review weekly and reorder early.`,
        },
      });
      out.push({
        category: "stock",
        severity: "info",
        title: { ar: "فرصة باقات (Bundles)", en: "Bundle opportunity" },
        body: {
          ar: `اصنع باقات من الأكثر مبيعاً مع منتجات أبطأ حركة بسعر مغرٍ — يصرّف المخزون الراكد ويرفع قيمة الطلب في نفس الوقت (مثلاً: مجلة رائجة + كتاب أنشطة).`,
          en: `Bundle best-sellers with slower-moving titles at an attractive price — clears slow stock and raises order value at once (e.g. a hit magazine + an activity book).`,
        },
      });
    }

    // --- Ads ---
    if (cities.length >= 3) {
      const top3Cities = cities.slice(0, 3);
      const top3Share = top3Cities.reduce((s, x) => s + Number(x.orders), 0) / k.total_orders;
      out.push({
        category: "ads",
        severity: "medium",
        title: { ar: "استهداف جغرافي للإعلانات", en: "Geo-target your ads" },
        body: {
          ar: `${top3Cities.map((x) => x.label).join(" و")} تمثل ${(top3Share * 100).toFixed(0)}% من طلباتك. ركّز ميزانية إعلانات فيسبوك وانستجرام هناك أولاً (تكلفة تحويل أقل)، وأنشئ جمهور مشابه (Lookalike) من عملائك الحاليين، ثم اختبر توسعاً تدريجياً في محافظات الدلتا.`,
          en: `${top3Cities.map((x) => x.label).join(", ")} generate ${(top3Share * 100).toFixed(0)}% of orders. Concentrate Facebook/Instagram ad budget there first (lower CPA), build Lookalike audiences from your existing customers, then test gradual expansion into Delta governorates.`,
        },
      });

      const risky = cities
        .filter((x) => Number(x.orders) > 50 && Number(x.cancelled_or_returned) / Number(x.orders) > 0.12)
        .slice(0, 3);
      if (risky.length) {
        out.push({
          category: "ads",
          severity: "medium",
          title: { ar: "مدن بنسبة مرتجعات مرتفعة", en: "Cities with high return rates" },
          body: {
            ar: `${risky.map((x) => `${x.label} (${formatPercent(Number(x.cancelled_or_returned), Number(x.orders))})`).join("، ")} — فكّر في استثنائها من حملات الاستهداف الواسع أو اشتراط الدفع المسبق فيها.`,
            en: `${risky.map((x) => `${x.label} (${formatPercent(Number(x.cancelled_or_returned), Number(x.orders))})`).join(", ")} — consider excluding them from broad ad targeting or requiring prepaid payment there.`,
          },
        });
      }
    }

    const mobileShare = sources
      .filter((s) => ["android", "ios"].includes(s.label.toLowerCase()))
      .reduce((s, x) => s + Number(x.orders), 0) / k.total_orders;
    if (mobileShare < 0.15) {
      out.push({
        category: "ads",
        severity: "info",
        title: { ar: "التطبيق غير مستغل", en: "Mobile app is under-used" },
        body: {
          ar: `${(mobileShare * 100).toFixed(1)}% فقط من الطلبات من التطبيق. مستخدم التطبيق أعلى ولاءً وأرخص في إعادة الاستهداف (إشعارات مجانية بدل إعلانات مدفوعة). أضف عرض "خصم أول طلب من التطبيق" وروّج له في فواتيرك وصفحات السوشيال.`,
          en: `Only ${(mobileShare * 100).toFixed(1)}% of orders come from the app. App users are more loyal and cheaper to re-target (free push notifications vs paid ads). Run a "first in-app order discount" and promote it on invoices and social pages.`,
        },
      });
    }

    // --- Ops ---
    if (k.avg_delivery_days != null && k.avg_delivery_days > 3.5) {
      out.push({
        category: "ops",
        severity: "high",
        title: { ar: "التوصيل أبطأ من المعيار", en: "Delivery slower than benchmark" },
        body: {
          ar: `متوسط التوصيل ${formatNumber(k.avg_delivery_days)} يوم. كل يوم تأخير يرفع احتمال رفض الاستلام في طلبات الدفع عند الاستلام. راجع أداء شركة الشحن حسب المحافظة في تبويب "التوصيل".`,
          en: `Average delivery takes ${formatNumber(k.avg_delivery_days)} days. Every extra day raises COD rejection probability. Review courier performance by governorate in the Delivery tab.`,
        },
      });
    }

    return out;
  }, [kpis.data, customers.data, byCity.data, bySource.data, byPromo.data, topProducts.data]);

  const loading = kpis.loading || byCity.loading || customers.loading;

  return (
    <div>
      <PageHeader
        title={t("insights")}
        subtitle={t("insightsSubtitle")}
        actions={<DateRangeFilter preset={preset} setPreset={setPreset} range={range} setRange={setRange} />}
      />

      {loading ? (
        <Spinner />
      ) : insights.length === 0 ? (
        <EmptyState message={t("noData")} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-2">
            {insights.map((ins, i) => {
              const meta = CATEGORY_META[ins.category];
              const Icon = meta.icon;
              return (
                <div
                  key={i}
                  className={cn(
                    "card p-5 border-s-4",
                    ins.severity === "high"
                      ? "border-s-red-500"
                      : ins.severity === "medium"
                        ? "border-s-amber-500"
                        : "border-s-brand-400"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn("rounded-lg p-2 shrink-0", meta.color)}>
                      <Icon size={18} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
                        {t(
                          ins.category === "marketing"
                            ? "marketingInsights"
                            : ins.category === "revenue"
                              ? "revenueInsights"
                              : ins.category === "stock"
                                ? "stockInsights"
                                : ins.category === "ads"
                                  ? "adsInsights"
                                  : "opsInsights"
                        )}
                      </div>
                      <h3 className="font-bold text-slate-900">{ins.title[lang]}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-slate-600">{ins.body[lang]}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {(attention.data ?? []).length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
                <AlertTriangle size={18} className="text-amber-500" />
                {t("attentionQueue")} ({(attention.data ?? []).length})
              </h2>
              <div className="card overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{t("orderNumber")}</th>
                      <th>{t("customer")}</th>
                      <th>{t("city")}</th>
                      <th>{t("status")}</th>
                      <th>{t("amount")}</th>
                      <th>{t("daysOpen")}</th>
                      <th>{t("reason")}</th>
                      <th>{t("whatsappFollowUp")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(attention.data ?? []).map((o) => (
                      <tr key={o.order_number}>
                        <td className="font-bold text-brand-700" dir="ltr">#{o.order_number}</td>
                        <td>
                          <div className="font-medium">{o.customer_name ?? "—"}</div>
                          <div className="text-xs text-slate-400" dir="ltr">{o.customer_phone ?? ""}</div>
                        </td>
                        <td>{o.city ?? "—"}</td>
                        <td><StatusBadge status={o.order_status} /></td>
                        <td>{formatMoney(o.total_order_amount, lang)}</td>
                        <td className="font-semibold text-amber-700">{formatNumber(o.days_open)}</td>
                        <td className="text-xs">
                          {o.reason === "stuck_in_delivery"
                            ? t("stuck_in_delivery")
                            : o.reason === "return_pending"
                              ? t("return_pending")
                              : o.reason === "not_shipped"
                                ? t("not_shipped")
                                : o.reason === "delivery_failed"
                                  ? t("delivery_failed")
                                  : o.reason}
                        </td>
                        <td>
                          <ContactActions
                            phone={o.customer_phone}
                            name={o.customer_name}
                            orderNumber={o.order_number}
                            waReason={
                              (["stuck_in_delivery", "return_pending", "not_shipped", "delivery_failed"].includes(o.reason)
                                ? o.reason
                                : "general") as FollowUpReason
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
