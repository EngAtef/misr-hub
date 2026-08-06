"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Search, Trash2, Check, X, Sparkles, Power } from "lucide-react";
import { createClient } from "../lib/supabase/client";
import { useLang } from "../lib/i18n";
import { adText } from "../lib/ads/strings";
import { formatMoney, formatNumber, cn } from "../lib/utils";
import { Spinner } from "../components/ui";
import type { AdMapping } from "../lib/ads/types";

interface Unmapped {
  ad_name: string;
  pattern: string;
  campaigns: string[] | null;
  accounts: string[] | null;
  spend: number;
  purchases: number;
  conversion_value: number;
  periods: number;
}

interface ProductHit {
  sku: string;
  product_name: string;
  units: number;
  revenue: number;
  score?: number;
}

/**
 * Linking an ad to the book it sells is what makes every other number on this
 * page real, so the editor puts the store's own sales data next to the ad:
 * suggestions come from books that actually sold, ranked by word overlap.
 */
export function AdsMapping({
  from,
  to,
  onChanged,
}: {
  from: string | null;
  to: string | null;
  onChanged: () => void;
}) {
  const { lang } = useLang();
  const x = adText(lang);
  const supabase = useMemo(() => createClient(), []);

  const [unmapped, setUnmapped] = useState<Unmapped[]>([]);
  const [maps, setMaps] = useState<AdMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{
    matchLevel: "ad" | "campaign";
    rawName: string;
    bookLabel: string;
    skus: string[];
    keyword: string;
  } | null>(null);
  const [suggest, setSuggest] = useState<ProductHit[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [u, m] = await Promise.all([
      supabase.rpc("fn_ads_unmapped", { p_from: from, p_to: to }),
      supabase.rpc("fn_ads_map_list"),
    ]);
    setUnmapped((u.data as Unmapped[]) ?? []);
    setMaps((m.data as AdMapping[]) ?? []);
    setLoading(false);
  }, [supabase, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const openEditor = useCallback(
    async (matchLevel: "ad" | "campaign", rawName: string, existing?: AdMapping) => {
      setEditing({
        matchLevel,
        rawName,
        bookLabel: existing?.book_label ?? rawName,
        skus: existing?.skus ?? [],
        keyword: existing?.keyword ?? "",
      });
      setQuery("");
      setHits([]);
      setSuggest([]);
      const { data } = await supabase.rpc("fn_ads_map_suggest", {
        p_name: rawName,
        p_from: from,
        p_to: to,
        p_limit: 8,
      });
      setSuggest((data as ProductHit[]) ?? []);
    },
    [supabase, from, to]
  );

  // product search for the picker (reuses the Products page RPC)
  useEffect(() => {
    if (!editing || query.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      const { data } = await supabase.rpc("fn_product_stats", {
        p_from: null,
        p_to: null,
        p_search: query.trim(),
        p_limit: 12,
      });
      if (!cancelled) setHits((data as ProductHit[]) ?? []);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, editing, supabase]);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    const ok = await post({
      action: "map",
      matchLevel: editing.matchLevel,
      rawName: editing.rawName,
      bookLabel: editing.bookLabel,
      skus: editing.skus,
      keyword: editing.keyword,
    });
    setSaving(false);
    if (ok) {
      setEditing(null);
      await load();
      onChanged();
    }
  }

  function toggleSku(sku: string) {
    setEditing((e) => (e ? { ...e, skus: e.skus.includes(sku) ? e.skus.filter((s) => s !== sku) : [...e.skus, sku] } : e));
  }

  if (loading) return <Spinner />;

  const skuRow = (p: ProductHit) => (
    <button
      key={p.sku}
      onClick={() => toggleSku(p.sku)}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-start text-sm transition",
        editing?.skus.includes(p.sku)
          ? "border-brand-400 bg-brand-50 text-brand-900"
          : "border-slate-200 hover:border-brand-300 hover:bg-slate-50"
      )}
    >
      <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", editing?.skus.includes(p.sku) ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300")}>
        {editing?.skus.includes(p.sku) && <Check size={11} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{p.product_name}</span>
      <span className="shrink-0 font-mono text-[11px] text-slate-400" dir="ltr">
        {p.sku}
      </span>
      <span className="shrink-0 text-xs text-slate-500">{formatNumber(p.units)}</span>
    </button>
  );

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------- backlog */}
      <div className="card p-5">
        <h3 className="text-sm font-bold text-slate-700">{x("unmappedTitle")}</h3>
        <p className="mt-1 text-xs text-slate-500">{x("unmappedHint")}</p>
        {unmapped.length === 0 ? (
          <div className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {lang === "ar" ? "كل الإعلانات مربوطة بكتب ✓" : "Every ad is linked to a book ✓"}
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{x("ad")}</th>
                  <th>{x("campaign")}</th>
                  <th>{x("spend")}</th>
                  <th>{x("metaPurchases")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {unmapped.map((u) => (
                  <tr key={u.pattern}>
                    <td className="font-medium">{u.ad_name}</td>
                    <td className="max-w-[260px] !whitespace-normal text-xs text-slate-500">
                      {(u.campaigns ?? []).slice(0, 2).join(" · ")}
                      {(u.campaigns?.length ?? 0) > 2 ? ` +${(u.campaigns?.length ?? 0) - 2}` : ""}
                    </td>
                    <td className="font-semibold">{formatMoney(u.spend, lang)}</td>
                    <td className="text-slate-500">{formatNumber(u.purchases)}</td>
                    <td>
                      <button className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => openEditor("ad", u.ad_name)}>
                        <Link2 size={13} />
                        {x("mapNow")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* --------------------------------------------------------- existing */}
      <div className="card p-5">
        <h3 className="mb-4 text-sm font-bold text-slate-700">{x("mappings")}</h3>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{x("ad")}</th>
                <th>{x("bookLabel")}</th>
                <th>{x("skus")}</th>
                <th>{x("spend")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {maps.map((m) => (
                <tr key={m.id} className={cn(!m.active && "opacity-50")}>
                  <td>
                    <div className="font-medium">{m.raw_name ?? m.pattern}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      {m.match_level === "campaign" && <span className="rounded bg-slate-100 px-1">{x("campaign")}</span>}
                      {m.is_auto && <span className="rounded bg-amber-100 px-1 text-amber-700">{x("auto")}</span>}
                      {!m.active && <span className="rounded bg-slate-200 px-1">{x("inactive")}</span>}
                    </div>
                  </td>
                  <td className="font-semibold">{m.book_label}</td>
                  <td className="max-w-[220px] !whitespace-normal">
                    {m.skus?.length ? (
                      <span className="font-mono text-[11px] text-brand-700" dir="ltr">
                        {m.skus.join(", ")}
                      </span>
                    ) : m.keyword ? (
                      <span className="text-xs text-slate-500">“{m.keyword}”</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td>{formatMoney(m.spend, lang)}</td>
                  <td>
                    <div className="flex gap-1">
                      <button
                        className="rounded p-1 text-slate-400 hover:bg-slate-100"
                        title={x("mapNow")}
                        onClick={() => openEditor(m.match_level, m.raw_name ?? m.pattern, m)}
                      >
                        <Link2 size={14} />
                      </button>
                      <button
                        className="rounded p-1 text-slate-400 hover:bg-slate-100"
                        title={x("inactive")}
                        onClick={async () => {
                          if (await post({ action: "map_toggle", id: m.id, active: !m.active })) {
                            await load();
                            onChanged();
                          }
                        }}
                      >
                        <Power size={14} />
                      </button>
                      <button
                        className="rounded p-1 text-red-400 hover:bg-red-50"
                        title={x("remove")}
                        onClick={async () => {
                          if (await post({ action: "map_delete", id: m.id })) {
                            await load();
                            onChanged();
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ----------------------------------------------------------- editor */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="card my-8 w-full max-w-2xl p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{editing.rawName}</h2>
                <p className="mt-1 text-xs text-slate-500">{x("keywordHint")}</p>
              </div>
              <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => setEditing(null)}>
                <X size={18} />
              </button>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-500">{x("bookLabel")}</span>
              <input
                className="input !py-1.5 text-sm"
                value={editing.bookLabel}
                onChange={(e) => setEditing({ ...editing, bookLabel: e.target.value })}
              />
            </label>

            {suggest.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                  <Sparkles size={13} className="text-brand-500" />
                  {x("suggestions")}
                </div>
                <div className="space-y-1.5">{suggest.map(skuRow)}</div>
              </div>
            )}

            <div className="mt-4">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-slate-400 start-3" />
                <input
                  className="input !py-1.5 ps-9 text-sm"
                  placeholder={x("searchProducts")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {hits.length > 0 && <div className="mt-2 space-y-1.5">{hits.map(skuRow)}</div>}
            </div>

            {editing.skus.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {editing.skus.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-1 text-[11px] font-semibold text-brand-800">
                    <span dir="ltr">{s}</span>
                    <button onClick={() => toggleSku(s)}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-semibold text-slate-500">{x("keyword")}</span>
              <input
                className="input !py-1.5 text-sm"
                value={editing.keyword}
                onChange={(e) => setEditing({ ...editing, keyword: e.target.value })}
                placeholder={editing.skus.length ? "—" : x("keyword")}
                disabled={editing.skus.length > 0}
              />
            </label>

            <div className="mt-6 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEditing(null)}>
                {x("cancel")}
              </button>
              <button className="btn-primary" onClick={save} disabled={saving || (!editing.skus.length && !editing.keyword.trim())}>
                <Check size={16} />
                {x("save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
