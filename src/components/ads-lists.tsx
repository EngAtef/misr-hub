"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { ChevronDown, Link2, Pencil, Trash2, X, Check, Sparkles, ExternalLink, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { AD } from "@/lib/ads/strings";
import { formatMoney, formatNumber, cn } from "@/lib/utils";
import { Spinner, EmptyState, KpiCard, Pagination } from "@/components/ui";
import { ProductDrawer } from "@/components/product-drawer";
import type { CustomListRow, CustomListItemRow, StockHealth } from "@/lib/ads/types";
import { confirmDialog } from "@/components/dialog";

const BOOKS_PER_PAGE = 50;

/** How a list's stock reads at a glance, and whether it demands action.
 *  `act` is what separates "some books ran out" from "stop spending". */
const STOCK_META: Record<StockHealth, { label: { ar: string; en: string }; hint: { ar: string; en: string }; className: string; act: boolean }> = {
  ok: { label: AD.shOk, hint: AD.shOkHint, className: "bg-emerald-100 text-emerald-800", act: false },
  thin: { label: AD.shThin, hint: AD.shThinHint, className: "bg-amber-100 text-amber-800", act: false },
  last_book: { label: AD.shLastBook, hint: AD.shLastBookHint, className: "bg-orange-100 text-orange-800", act: true },
  empty: { label: AD.shEmpty, hint: AD.shEmptyHint, className: "bg-red-100 text-red-700", act: true },
  unknown: { label: AD.shUnknown, hint: AD.shUnknownHint, className: "bg-slate-100 text-slate-600", act: false },
};

interface SlugHit {
  slug: string;
  views: number | null;
  taken_by: string | null;
  score: number;
  /** `ad_link` = an ad really points here, `ga4` = the page just had traffic */
  source: "ad_link" | "ga4";
  ads: number;
  spend: number;
  ad_names: string[] | null;
}

const STORE = "https://nahdetmisrbookstore.com/ar/products/list/";

/**
 * The custom lists an ad can point at, each shown against what it actually
 * earned. A list is the real unit of ad attribution here: one list = one pool
 * of store sales shared by every ad linking to it.
 *
 * The slug is the only field the platform's export can't give us, and it's the
 * one that makes link-based connecting work — so attaching it is the primary
 * action on this screen, with candidates taken from the list pages GA4 has
 * actually recorded traffic on.
 */
export function AdsLists({
  from,
  to,
  onChanged,
}: {
  from: string | null;
  to: string | null;
  onChanged: () => void;
}) {
  const { lang } = useLang();
  const tx = useCallback((v: { ar: string; en: string }) => v[lang], [lang]);
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<CustomListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, CustomListItemRow[]>>({});
  const [editing, setEditing] = useState<CustomListRow | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "ads" | "noslug" | "stock">("all");
  const [slugs, setSlugs] = useState<SlugHit[]>([]);
  // per-list page index for the book drill-down; a list can hold 3,500+ books
  const [bookPage, setBookPage] = useState<Record<string, number>>({});

  // ad links whose slug no uploaded list has claimed — connecting these is
  // the single highest-value action on this screen
  const unclaimed = useMemo(
    () => slugs.filter((s) => s.source === "ad_link" && !s.taken_by).sort((a, b) => b.spend - a.spend),
    [slugs]
  );
  const [drawerSku, setDrawerSku] = useState<{ sku: string; name?: string | null; stock?: number | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [o, s] = await Promise.all([
      supabase.rpc("fn_custom_lists_overview", { p_from: from, p_to: to }),
      // the slugs the ads themselves point at — the worklist for attaching
      supabase.rpc("fn_ads_slug_suggest", { p_text: "", p_limit: 60 }),
    ]);
    // an errored RPC must never look like "no lists" — that mistake has cost
    // this project a day before (see the July ads import)
    if (o.error) setLoadError(o.error.message);
    setRows((o.data as CustomListRow[]) ?? []);
    setSlugs((s.data as SlugHit[]) ?? []);
    setLoading(false);
  }, [supabase, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleRow = useCallback(
    async (row: CustomListRow) => {
      if (expanded === row.id) {
        setExpanded(null);
        return;
      }
      setExpanded(row.id);
      setBookPage((p) => ({ ...p, [row.id]: p[row.id] ?? 0 }));
      if (items[row.id]) return;
      const { data } = await supabase.rpc("fn_custom_list_items", { p_list: row.id, p_from: from, p_to: to });
      setItems((m) => ({ ...m, [row.id]: (data as CustomListItemRow[]) ?? [] }));
    },
    [expanded, items, supabase, from, to]
  );

  // 200+ lists, so the table is only usable with a filter on it
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "ads" && !r.ads) return false;
      if (filter === "noslug" && r.slug) return false;
      if (filter === "stock" && !STOCK_META[r.stock_health]?.act) return false;
      if (q && !`${r.name} ${r.slug ?? ""} ${r.list_id ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, filter, query]);

  const money = (v: number | null | undefined) => formatMoney(v ?? 0, lang);
  const num2 = (v: number | null | undefined, s = "") => (v === null || v === undefined ? "—" : `${v.toFixed(2)}${s}`);

  const totals = useMemo(
    () =>
      rows.reduce(
        (t, r) => ({
          lists: t.lists + 1,
          books: t.books + r.item_count,
          spend: t.spend + r.spend,
          revenue: t.revenue + r.revenue,
          connected: t.connected + (r.ads > 0 ? 1 : 0),
          noSlug: t.noSlug + (r.slug ? 0 : 1),
          needsStock: t.needsStock + (STOCK_META[r.stock_health]?.act ? 1 : 0),
        }),
        { lists: 0, books: 0, spend: 0, revenue: 0, connected: 0, noSlug: 0, needsStock: 0 }
      ),
    [rows]
  );

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-semibold">{tx(AD.loadError)}</span>
          <span className="text-xs opacity-70" dir="ltr">{loadError}</span>
          <button className="btn-secondary !py-1 text-xs ms-auto" onClick={load}>
            {tx(AD.retry)}
          </button>
        </div>
      )}

      <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-xs leading-relaxed text-brand-900">
        {tx(AD.listsSubtitle)}
      </div>

      {unclaimed.length > 0 && (
        <div className="card border-amber-200 p-5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-amber-800">
            <AlertTriangle size={15} />
            {tx(AD.adLinksTitle)} ({formatNumber(unclaimed.length)})
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">{tx(AD.adLinksHint)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {unclaimed.map((s) => (
              <div
                key={s.slug}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs"
                title={(s.ad_names ?? []).join(" · ")}
              >
                <div className="font-mono font-bold text-amber-900" dir="ltr">
                  {s.slug}
                </div>
                <div className="mt-0.5 text-[11px] text-amber-800">
                  {formatNumber(s.ads)} {tx(AD.adsPointing)} · {money(s.spend)}
                </div>
                <div className="mt-0.5 max-w-[220px] truncate text-[10px] text-slate-500">
                  {(s.ad_names ?? []).join(" · ")}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">{tx(AD.shortLinksNote)}</p>
        </div>
      )}

      {!rows.length ? (
        <EmptyState message={tx(AD.listsEmpty)} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <KpiCard
              label={tx(AD.listsTitle)}
              value={formatNumber(totals.lists)}
              accent="brand"
              sub={`${formatNumber(totals.books)} ${tx(AD.listItems)}`}
            />
            <KpiCard
              label={tx(AD.listAds)}
              value={`${formatNumber(totals.connected)} / ${formatNumber(totals.lists)}`}
              accent={totals.connected ? "green" : "slate"}
              sub={totals.noSlug ? `${formatNumber(totals.noSlug)} ${tx(AD.listNoSlug)}` : undefined}
            />
            <KpiCard label={tx(AD.spend)} value={money(totals.spend)} accent="red" />
            <KpiCard
              label={tx(AD.listRevenue)}
              value={money(totals.revenue)}
              accent="green"
              sub={totals.spend > 0 ? `${(totals.revenue / totals.spend).toFixed(2)}x` : undefined}
            />
          </div>

          <div className="card p-4">
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { k: "all" as const, label: AD.filterAll, n: rows.length },
                  { k: "ads" as const, label: AD.listAds, n: totals.connected },
                  { k: "noslug" as const, label: AD.listNoSlug, n: totals.noSlug },
                  { k: "stock" as const, label: AD.stockHealth, n: totals.needsStock },
                ] as const
              ).map((f) => (
                <button
                  key={f.k}
                  onClick={() => setFilter(f.k)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                    filter === f.k ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  {tx(f.label)} ({formatNumber(f.n)})
                </button>
              ))}
              <input
                className="input !py-1.5 w-[240px] text-sm ms-auto"
                placeholder={tx(AD.searchLists)}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="text-xs text-slate-500">
                {tx(AD.showing)} {formatNumber(shown.length)} / {formatNumber(rows.length)}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">{tx(AD.clickToSeeBooks)}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{tx(AD.stockRule)}</p>
          </div>

          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{tx(AD.list)}</th>
                  <th>{tx(AD.listItems)}</th>
                  <th>{tx(AD.listInStock)}</th>
                  <th>{tx(AD.stockHealth)}</th>
                  <th>{tx(AD.listAds)}</th>
                  <th>{tx(AD.spend)}</th>
                  <th>{tx(AD.listPageViews)}</th>
                  <th>{tx(AD.bookOrders)}</th>
                  <th>{tx(AD.listRevenue)}</th>
                  <th>{tx(AD.listRoas)}</th>
                  <th>{tx(AD.cpa)}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const open = expanded === r.id;
                  const unknown = r.item_count - r.known_items;
                  return (
                    <Fragment key={r.id}>
                      {/* the whole row opens the list: a list's name says
                          nothing about which books are in it, and that's the
                          thing you need to know before connecting an ad */}
                      <tr
                        className={cn("cursor-pointer hover:bg-slate-50", open && "bg-slate-50")}
                        onClick={() => toggleRow(r)}
                      >
                        <td className="!whitespace-normal max-w-[260px]">
                          <div className="font-semibold">{r.name}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                            {r.list_id !== null && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-500" dir="ltr">
                                #{r.list_id}
                              </span>
                            )}
                            {r.slug ? (
                              <a
                                href={`${STORE}${r.slug}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 font-mono text-brand-700 hover:bg-brand-100"
                                dir="ltr"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {r.slug}
                                <ExternalLink size={9} />
                              </a>
                            ) : (
                              <button
                                className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800 hover:bg-amber-200"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditing(r);
                                }}
                              >
                                <Link2 size={9} />
                                {tx(AD.listNoSlug)}
                              </button>
                            )}
                          </div>
                        </td>
                        <td>
                          {formatNumber(r.item_count)}
                          {unknown > 0 && (
                            <span
                              className="ms-1 inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-600"
                              title={tx(AD.listUnknown)}
                            >
                              <AlertTriangle size={10} />
                              {formatNumber(unknown)}
                            </span>
                          )}
                        </td>
                        {/* what's still SELLABLE leads; books that ran out are
                            context, not an alarm */}
                        <td>
                          <span className="font-semibold">{formatNumber(r.in_stock)}</span>
                          <span className="text-slate-400"> / {formatNumber(r.item_count)}</span>
                          {r.out_of_stock > 0 && (
                            <div className="text-[11px] text-slate-500" title={tx(AD.listOutOfStock)}>
                              {formatNumber(r.out_of_stock)} {tx(AD.listOutOfStock)}
                            </div>
                          )}
                        </td>
                        <td>
                          {(() => {
                            const m = STOCK_META[r.stock_health] ?? STOCK_META.unknown;
                            return (
                              <span
                                className={cn(
                                  "inline-block rounded-full px-2.5 py-0.5 text-xs font-bold",
                                  m.className
                                )}
                                title={tx(m.hint)}
                              >
                                {tx(m.label)}
                              </span>
                            );
                          })()}
                          {/* only a list with money behind it turns a stock
                              problem into something to do right now */}
                          {STOCK_META[r.stock_health]?.act && r.ads > 0 && (
                            <div className="mt-0.5 text-[11px] font-semibold text-red-600">
                              {r.stock_health === "empty" ? tx(AD.shEmpty) : tx(AD.shLastBook)}
                            </div>
                          )}
                        </td>
                        <td className={cn(!r.ads && "text-slate-300")}>{r.ads ? formatNumber(r.ads) : "—"}</td>
                        <td className="font-semibold">{r.spend > 0 ? money(r.spend) : "—"}</td>
                        <td className="text-slate-500" title={tx(AD.listPageViewsHint)}>
                          {r.page_views === null ? "—" : formatNumber(r.page_views)}
                        </td>
                        <td>{formatNumber(r.orders)}</td>
                        <td className="font-semibold text-emerald-700">{money(r.revenue)}</td>
                        <td
                          className={cn(
                            "font-bold",
                            r.roas === null
                              ? "text-slate-300"
                              : r.roas >= 3
                              ? "text-emerald-600"
                              : r.roas >= 1.5
                              ? "text-amber-600"
                              : "text-red-600"
                          )}
                        >
                          {num2(r.roas, "x")}
                        </td>
                        <td>{r.cpa === null ? "—" : money(r.cpa)}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1">
                            <button
                              className="rounded p-1 text-slate-400 hover:bg-slate-100"
                              title={tx(AD.editList)}
                              onClick={() => setEditing(r)}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              className="rounded p-1 text-slate-400 hover:bg-slate-100"
                              title={open ? tx(AD.hideBooks) : tx(AD.previewBooks)}
                              onClick={() => toggleRow(r)}
                            >
                              <ChevronDown size={15} className={cn("transition", open && "rotate-180")} />
                            </button>
                            <button
                              className="rounded p-1 text-red-400 hover:bg-red-50"
                              title={tx(AD.deleteList)}
                              onClick={async () => {
                                if (!await confirmDialog(tx(AD.deleteListConfirm))) return;
                                await fetch("/api/ads", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: "list_delete", id: r.id }),
                                });
                                await load();
                                onChanged();
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {open && (
                        <tr>
                          <td colSpan={12} className="!whitespace-normal bg-slate-50 p-4">
                            {r.campaigns?.length ? (
                              <div className="mb-3 text-xs text-slate-500">
                                <span className="font-semibold">{tx(AD.gapCampaignsCol)}:</span>{" "}
                                {r.campaigns.slice(0, 4).join(" · ")}
                                {r.campaigns.length > 4 ? ` +${r.campaigns.length - 4}` : ""}
                              </div>
                            ) : (
                              <div className="mb-3 text-xs text-amber-700">{tx(AD.listNoAds)}</div>
                            )}
                            {(() => {
                              const all = items[r.id] ?? [];
                              const page = bookPage[r.id] ?? 0;
                              const totalPages = Math.max(1, Math.ceil(all.length / BOOKS_PER_PAGE));
                              const safe = Math.min(page, totalPages - 1);
                              const slice = all.slice(safe * BOOKS_PER_PAGE, safe * BOOKS_PER_PAGE + BOOKS_PER_PAGE);
                              return (
                                <>
                            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                              <table className="table-base">
                                <thead>
                                  <tr>
                                    <th>#</th>
                                    <th>{tx(AD.book)}</th>
                                    <th>SKU</th>
                                    <th>{tx(AD.bookStock)}</th>
                                    <th>{lang === "ar" ? "قطع مباعة" : "Units"}</th>
                                    <th>{lang === "ar" ? "طلبات" : "Orders"}</th>
                                    <th>{lang === "ar" ? "إيراد" : "Revenue"}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {slice.map((it) => (
                                    <tr
                                      key={it.sku}
                                      className="cursor-pointer"
                                      onClick={() =>
                                        setDrawerSku({ sku: it.sku, name: it.product_name, stock: it.ecom_stock })
                                      }
                                    >
                                      <td className="text-slate-400">{it.sort_order ?? "—"}</td>
                                      <td className="!whitespace-normal max-w-[300px] font-medium">
                                        {it.product_name ?? "—"}
                                        {!it.in_catalog && (
                                          <span className="ms-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                                            {tx(AD.notInCatalog)}
                                          </span>
                                        )}
                                      </td>
                                      <td className="font-mono text-[11px] text-slate-400" dir="ltr">
                                        {it.sku}
                                      </td>
                                      <td className={cn((it.ecom_stock ?? 1) <= 0 && "font-semibold text-red-600")}>
                                        {it.ecom_stock === null ? "—" : formatNumber(it.ecom_stock)}
                                      </td>
                                      <td>{formatNumber(it.units)}</td>
                                      <td className="text-slate-500">{formatNumber(it.orders)}</td>
                                      <td className="font-semibold">{money(it.revenue)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            {all.length > BOOKS_PER_PAGE && (
                              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                                <span className="text-xs text-slate-500">
                                  {formatNumber(safe * BOOKS_PER_PAGE + 1)}–
                                  {formatNumber(Math.min((safe + 1) * BOOKS_PER_PAGE, all.length))}{" "}
                                  {tx(AD.ofBooks)} {formatNumber(all.length)}
                                </span>
                                <Pagination
                                  page={safe}
                                  totalPages={totalPages}
                                  onPage={(p) => setBookPage((m) => ({ ...m, [r.id]: p }))}
                                />
                              </div>
                            )}
                                </>
                              );
                            })()}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs leading-relaxed text-slate-500">{tx(AD.listPageViewsHint)}</p>
        </>
      )}

      {editing && (
        <ListEditor
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
            onChanged();
          }}
        />
      )}

      <ProductDrawer
        sku={drawerSku?.sku ?? null}
        name={drawerSku?.name}
        stock={drawerSku?.stock}
        onClose={() => setDrawerSku(null)}
      />
    </div>
  );
}

/** Rename a list and attach the slug its ads link to. Slug candidates come
 *  from GA4's own record of which list pages got traffic, so the buyer picks
 *  from real URLs instead of typing one from memory. */
function ListEditor({
  row,
  onClose,
  onSaved,
}: {
  row: CustomListRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { lang } = useLang();
  const tx = (v: { ar: string; en: string }) => v[lang];
  const supabase = useMemo(() => createClient(), []);

  const [name, setName] = useState(row.name);
  const [slug, setSlug] = useState(row.slug ?? "");
  const [hits, setHits] = useState<SlugHit[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("fn_ads_slug_suggest", { p_text: row.name, p_limit: 14 });
      if (!cancelled) setHits((data as SlugHit[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, row.name]);

  // a pasted full URL is fine — show the buyer what will actually be stored
  const cleanSlug = slug.trim().replace(/^.*\/products\/list\//, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

  async function save() {
    setSaving(true);
    setErr("");
    const res = await fetch("/api/ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list_set", id: row.id, name, slug: cleanSlug }),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else setErr(((await res.json()) as { error?: string }).error ?? "failed");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="card my-10 w-full max-w-xl p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{row.name}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {formatNumber(row.item_count)} {tx(AD.listItems)}
              {row.list_id !== null && <span dir="ltr"> · #{row.list_id}</span>}
            </p>
          </div>
          <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-500">{tx(AD.listName)}</span>
          <input className="input !py-1.5 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-semibold text-slate-500">{tx(AD.listSlug)}</span>
          <input
            className="input !py-1.5 text-sm"
            dir="ltr"
            placeholder="kalam-saleem"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">{tx(AD.listSlugHint)}</span>
          {cleanSlug && (
            <span className="mt-1 block font-mono text-[11px] text-brand-700" dir="ltr">
              {STORE}
              {cleanSlug}
            </span>
          )}
        </label>

        {hits.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              <Sparkles size={13} className="text-brand-500" />
              {tx(AD.slugSuggestions)}
            </div>
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {hits.map((h) => {
                const takenByOther = h.taken_by !== null && h.slug !== (row.slug ?? "").toLowerCase();
                return (
                  <button
                    key={h.slug}
                    onClick={() => setSlug(h.slug)}
                    disabled={takenByOther}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-start text-sm transition",
                      cleanSlug.toLowerCase() === h.slug
                        ? "border-brand-400 bg-brand-50 text-brand-900"
                        : takenByOther
                        ? "cursor-not-allowed border-slate-200 opacity-50"
                        : "border-slate-200 hover:border-brand-300 hover:bg-slate-50",
                      h.score > 0 && cleanSlug.toLowerCase() !== h.slug && !takenByOther && "border-brand-200"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" dir="ltr">
                      {h.slug}
                    </span>
                    {/* an ad pointing here is far stronger evidence than page
                        traffic, so it is called out explicitly */}
                    {h.source === "ad_link" ? (
                      <span
                        className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800"
                        title={(h.ad_names ?? []).join(" · ")}
                      >
                        {tx(AD.fromAdLink)} · {formatNumber(h.ads)}
                      </span>
                    ) : (
                      h.score > 0 && (
                        <span className="shrink-0 rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">
                          {tx(AD.suggested)}
                        </span>
                      )
                    )}
                    {takenByOther && (
                      <span className="shrink-0 truncate text-[10px] text-slate-500">
                        {tx(AD.slugTaken)} {h.taken_by}
                      </span>
                    )}
                    <span className="shrink-0 text-[11px] text-slate-400">
                      {h.views === null ? "—" : `${formatNumber(h.views)} ${tx(AD.views)}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {err && <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}

        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            {tx(AD.cancel)}
          </button>
          <button className="btn-primary" onClick={save} disabled={saving || !name.trim()}>
            <Check size={16} />
            {tx(AD.save)}
          </button>
        </div>
      </div>
    </div>
  );
}
