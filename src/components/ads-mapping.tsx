"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Search, Trash2, Check, X, Sparkles, Power, Wand2, ExternalLink, ListTree, BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { adText, AD } from "@/lib/ads/strings";
import { formatMoney, formatNumber, cn } from "@/lib/utils";
import { Spinner } from "@/components/ui";
import type { AdMapping, TargetKind, LinkResolved } from "@/lib/ads/types";

interface Unmapped {
  ad_name: string;
  pattern: string;
  campaigns: string[] | null;
  accounts: string[] | null;
  spend: number;
  purchases: number;
  conversion_value: number;
  periods: number;
  dest_url: string | null;
  suggest_list_key: string | null;
  suggest_list_name: string | null;
  suggest_reason: "url" | "name" | null;
}

interface ProductHit {
  sku: string;
  product_name: string;
  units: number;
  revenue: number;
  score?: number;
}

interface ListOption {
  id: string;
  name: string;
  slug: string | null;
  list_id: number | null;
  item_count: number;
}

interface Editing {
  matchLevel: "ad" | "campaign";
  rawName: string;
  targetKind: TargetKind;
  bookLabel: string;
  listKey: string | null;
  destUrl: string;
  skus: string[];
  keyword: string;
}

const STORE_LIST = "https://nahdetmisrbookstore.com/ar/products/list/";

/**
 * Connecting an ad to what it sells is what makes every other number on this
 * page real. The store's ads link to a CUSTOM LIST, so that's the default
 * door; pasting the ad's link resolves to the same thing, and hand-picked SKUs
 * remain for the ads that point at a single book.
 *
 * Suggestions never auto-apply. A wrong connection silently moves real money
 * into the wrong revenue pool, so the buyer always confirms.
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
  const tx = useCallback((v: { ar: string; en: string }) => v[lang], [lang]);
  const supabase = useMemo(() => createClient(), []);

  const [unmapped, setUnmapped] = useState<Unmapped[]>([]);
  const [maps, setMaps] = useState<AdMapping[]>([]);
  const [lists, setLists] = useState<ListOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [suggest, setSuggest] = useState<ProductHit[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [resolved, setResolved] = useState<LinkResolved | null>(null);
  const [listQuery, setListQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [u, m, l] = await Promise.all([
      supabase.rpc("fn_ads_unmapped", { p_from: from, p_to: to }),
      supabase.rpc("fn_ads_map_list"),
      supabase.from("custom_lists").select("id,name,slug,list_id,item_count").order("name"),
    ]);
    setUnmapped((u.data as Unmapped[]) ?? []);
    setMaps((m.data as AdMapping[]) ?? []);
    setLists((l.data as ListOption[]) ?? []);
    setLoading(false);
  }, [supabase, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const openEditor = useCallback(
    async (matchLevel: "ad" | "campaign", rawName: string, existing?: AdMapping, presetUrl?: string | null) => {
      // default to the door that fits: an ad that already carries a link opens
      // on the link, an existing mapping opens on however it was made, and a
      // fresh one opens on the list picker because that's the normal case
      const kind: TargetKind = existing
        ? existing.target_kind
        : presetUrl
        ? "link"
        : "list";
      setEditing({
        matchLevel,
        rawName,
        targetKind: kind,
        bookLabel: existing?.book_label ?? "",
        listKey: existing?.list_key ?? null,
        destUrl: existing?.dest_url ?? presetUrl ?? "",
        skus: existing?.skus ?? [],
        keyword: existing?.keyword ?? "",
      });
      setQuery("");
      setListQuery("");
      setHits([]);
      setSuggest([]);
      setResolved(null);
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

  // product search for the SKU picker (reuses the Products page RPC)
  useEffect(() => {
    if (!editing || editing.targetKind !== "book" || query.trim().length < 2) {
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

  // resolve a pasted link as it's typed, so the buyer sees what it points at
  // before saving rather than after
  useEffect(() => {
    const url = editing?.targetKind === "link" ? editing.destUrl.trim() : "";
    if (url.length < 8) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      const { data } = await supabase.rpc("fn_ads_link_resolve", { p_url: url });
      if (!cancelled) setResolved((data as LinkResolved) ?? null);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [editing?.targetKind, editing?.destUrl, supabase]);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    const ok = await post({
      action: "map",
      matchLevel: editing.matchLevel,
      rawName: editing.rawName,
      bookLabel: editing.bookLabel,
      targetKind: editing.targetKind,
      listKey: editing.targetKind === "book" ? null : editing.listKey,
      destUrl: editing.targetKind === "book" ? null : editing.destUrl,
      skus: editing.targetKind === "book" ? editing.skus : [],
      keyword: editing.targetKind === "book" ? editing.keyword : null,
    });
    setSaving(false);
    if (ok) {
      setEditing(null);
      await load();
      onChanged();
    }
  }

  /** One-click connect straight from the backlog's suggestion. */
  async function connectSuggested(u: Unmapped) {
    if (!u.suggest_list_key) return;
    setBusy(true);
    const ok = await post({
      action: "map",
      matchLevel: "ad",
      rawName: u.ad_name,
      bookLabel: u.suggest_list_name,
      targetKind: "list",
      listKey: u.suggest_list_key,
      destUrl: u.dest_url,
    });
    setBusy(false);
    if (ok) {
      await load();
      onChanged();
    }
  }

  async function runAutolink() {
    setBusy(true);
    setNotice("");
    const r = await post({ action: "autolink" });
    setBusy(false);
    const n = Number((r?.result as { linked?: number } | undefined)?.linked ?? 0);
    setNotice(n > 0 ? tx(AD.autolinkDone).replace("{n}", String(n)) : tx(AD.autolinkNone));
    if (n > 0) {
      await load();
      onChanged();
    }
  }

  function toggleSku(sku: string) {
    setEditing((e) => (e ? { ...e, skus: e.skus.includes(sku) ? e.skus.filter((s) => s !== sku) : [...e.skus, sku] } : e));
  }

  const listsFiltered = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    if (!q) return lists;
    return lists.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        (l.slug ?? "").toLowerCase().includes(q) ||
        String(l.list_id ?? "").includes(q)
    );
  }, [lists, listQuery]);

  const chosenList = useMemo(() => lists.find((l) => l.id === editing?.listKey) ?? null, [lists, editing?.listKey]);

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
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
          editing?.skus.includes(p.sku) ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300"
        )}
      >
        {editing?.skus.includes(p.sku) && <Check size={11} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{p.product_name}</span>
      <span className="shrink-0 font-mono text-[11px] text-slate-400" dir="ltr">
        {p.sku}
      </span>
      <span className="shrink-0 text-xs text-slate-500">{formatNumber(p.units)}</span>
    </button>
  );

  /** What a saved mapping actually resolves to, in one cell. */
  const targetCell = (m: AdMapping) => {
    if (m.target_kind === "list" && m.list_name) {
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-800">
            <ListTree size={10} />
            {m.list_name}
          </span>
          <span className="text-[11px] text-slate-500">
            {formatNumber(m.list_items)} {tx(AD.listItems)}
          </span>
          {m.list_slug && (
            <a
              href={`${STORE_LIST}${m.list_slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 font-mono text-[10px] text-slate-400 hover:text-brand-600"
              dir="ltr"
            >
              {m.list_slug}
              <ExternalLink size={8} />
            </a>
          )}
        </div>
      );
    }
    if (m.skus?.length) {
      return (
        <span className="font-mono text-[11px] text-brand-700" dir="ltr">
          {m.skus.slice(0, 4).join(", ")}
          {m.skus.length > 4 ? ` +${m.skus.length - 4}` : ""}
        </span>
      );
    }
    if (m.keyword) return <span className="text-xs text-slate-500">“{m.keyword}”</span>;
    if (m.dest_url) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-amber-700" dir="ltr">
          <Link2 size={10} />
          {m.dest_url.replace(/^https?:\/\/[^/]+/, "").slice(0, 46)}
        </span>
      );
    }
    return <span className="text-slate-300">—</span>;
  };

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------- backlog */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-700">{x("unmappedTitle")}</h3>
            <p className="mt-1 text-xs text-slate-500">{x("unmappedHint")}</p>
          </div>
          <div className="text-end">
            <button className="btn-secondary !py-1.5 text-xs" onClick={runAutolink} disabled={busy}>
              <Wand2 size={13} />
              {tx(AD.autolink)}
            </button>
            <p className="mt-1 max-w-[280px] text-[11px] leading-relaxed text-slate-400">{tx(AD.autolinkHint)}</p>
          </div>
        </div>

        {notice && (
          <div className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-xs leading-relaxed text-brand-800">{notice}</div>
        )}

        {unmapped.length === 0 ? (
          <div className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {lang === "ar" ? "كل الإعلانات موصولة ✓" : "Every ad is connected ✓"}
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{x("ad")}</th>
                  <th>{x("campaign")}</th>
                  <th>{x("spend")}</th>
                  <th>{tx(AD.suggested)}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {unmapped.map((u) => (
                  <tr key={u.pattern}>
                    <td className="!whitespace-normal max-w-[200px]">
                      <div className="font-medium">{u.ad_name}</div>
                      {u.dest_url && (
                        <div className="mt-0.5 font-mono text-[10px] text-slate-400" dir="ltr">
                          {u.dest_url.replace(/^https?:\/\/[^/]+/, "").slice(0, 40)}
                        </div>
                      )}
                    </td>
                    <td className="max-w-[220px] !whitespace-normal text-xs text-slate-500">
                      {(u.campaigns ?? []).slice(0, 2).join(" · ")}
                      {(u.campaigns?.length ?? 0) > 2 ? ` +${(u.campaigns?.length ?? 0) - 2}` : ""}
                    </td>
                    <td className="font-semibold">{formatMoney(u.spend, lang)}</td>
                    <td className="!whitespace-normal max-w-[190px]">
                      {u.suggest_list_name ? (
                        <>
                          <div className="text-xs font-semibold text-slate-700">{u.suggest_list_name}</div>
                          <div className="text-[10px] text-slate-400">
                            {u.suggest_reason === "url" ? tx(AD.suggestedFromUrl) : tx(AD.suggestedFromName)}
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-1.5">
                        {u.suggest_list_key && (
                          <button
                            className="btn-primary !px-2.5 !py-1 text-xs"
                            disabled={busy}
                            onClick={() => connectSuggested(u)}
                            title={`${tx(AD.connectSuggested)} ${u.suggest_list_name}`}
                          >
                            <Check size={13} />
                            {tx(AD.connectSuggested)}
                          </button>
                        )}
                        <button
                          className="btn-secondary !px-2.5 !py-1 text-xs"
                          onClick={() => openEditor("ad", u.ad_name, undefined, u.dest_url)}
                        >
                          <Link2 size={13} />
                          {x("mapNow")}
                        </button>
                      </div>
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
                <th>{tx(AD.targetColumn)}</th>
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
                  <td className="max-w-[280px] !whitespace-normal">{targetCell(m)}</td>
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
                <p className="mt-1 text-xs text-slate-500">{tx(AD.connectTo)}</p>
              </div>
              <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => setEditing(null)}>
                <X size={18} />
              </button>
            </div>

            {/* the three doors */}
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  { kind: "list" as TargetKind, Icon: ListTree, label: AD.targetList, hint: AD.targetListHint },
                  { kind: "link" as TargetKind, Icon: Link2, label: AD.targetLink, hint: AD.targetLinkHint },
                  { kind: "book" as TargetKind, Icon: BookOpen, label: AD.targetBook, hint: AD.targetBookHint },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.kind}
                  onClick={() => setEditing({ ...editing, targetKind: opt.kind })}
                  className={cn(
                    "rounded-xl border p-3 text-start transition",
                    editing.targetKind === opt.kind
                      ? "border-brand-500 bg-brand-50 ring-1 ring-brand-400"
                      : "border-slate-200 hover:border-brand-300 hover:bg-slate-50"
                  )}
                >
                  <opt.Icon
                    size={16}
                    className={editing.targetKind === opt.kind ? "text-brand-600" : "text-slate-400"}
                  />
                  <div className="mt-1.5 text-sm font-bold text-slate-800">{tx(opt.label)}</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{tx(opt.hint)}</div>
                </button>
              ))}
            </div>

            {/* ---- door 1: pick a custom list */}
            {editing.targetKind === "list" && (
              <div className="mt-5">
                {!lists.length ? (
                  <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
                    {tx(AD.listsEmpty)}
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search size={14} className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-slate-400 start-3" />
                      <input
                        className="input !py-1.5 ps-9 text-sm"
                        placeholder={tx(AD.searchLists)}
                        value={listQuery}
                        onChange={(e) => setListQuery(e.target.value)}
                      />
                    </div>
                    <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
                      {listsFiltered.map((l) => (
                        <button
                          key={l.id}
                          onClick={() => setEditing({ ...editing, listKey: l.id, bookLabel: editing.bookLabel || l.name })}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-start text-sm transition",
                            editing.listKey === l.id
                              ? "border-brand-400 bg-brand-50 text-brand-900"
                              : "border-slate-200 hover:border-brand-300 hover:bg-slate-50"
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                              editing.listKey === l.id ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300"
                            )}
                          >
                            {editing.listKey === l.id && <Check size={10} />}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium">{l.name}</span>
                          {l.slug ? (
                            <span className="shrink-0 font-mono text-[10px] text-slate-400" dir="ltr">
                              {l.slug}
                            </span>
                          ) : (
                            <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-700">
                              {tx(AD.listNoSlug)}
                            </span>
                          )}
                          <span className="shrink-0 text-[11px] text-slate-500">
                            {formatNumber(l.item_count)} {tx(AD.listItems)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ---- door 2: paste the ad's link */}
            {editing.targetKind === "link" && (
              <div className="mt-5">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-500">{tx(AD.pasteLink)}</span>
                  <input
                    className="input !py-1.5 text-sm"
                    dir="ltr"
                    placeholder={`${STORE_LIST}kalam-saleem`}
                    value={editing.destUrl}
                    onChange={(e) => setEditing({ ...editing, destUrl: e.target.value })}
                  />
                </label>

                {resolved && (
                  <div className="mt-3">
                    {/* kind alone only describes the URL's SHAPE — a list URL
                        whose slug we've never seen still comes back as "list",
                        so the resolved key is what proves we know it */}
                    {resolved.kind === "list" && resolved.list_key ? (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
                        <div className="font-bold">{tx(AD.linkIsList)}</div>
                        <div className="mt-1">
                          {resolved.list_name} · {formatNumber(resolved.list_items ?? 0)} {tx(AD.listItems)}
                        </div>
                      </div>
                    ) : resolved.kind === "product" && resolved.sku ? (
                      <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-xs text-brand-900">
                        <div className="font-bold">{tx(AD.linkIsProduct)}</div>
                        <div className="mt-1">
                          {resolved.product_name}{" "}
                          <span className="font-mono text-[11px]" dir="ltr">
                            {resolved.sku}
                          </span>
                        </div>
                      </div>
                    ) : resolved.ref ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
                        {tx(AD.linkUnknownList).replace("{slug}", resolved.ref)}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                        {tx(AD.linkUnknown)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ---- door 3: hand-picked SKUs (the original behaviour) */}
            {editing.targetKind === "book" && (
              <>
                {suggest.length > 0 && (
                  <div className="mt-5">
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
                      <span
                        key={s}
                        className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-1 text-[11px] font-semibold text-brand-800"
                      >
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
                  <span className="mt-1 block text-[11px] text-slate-400">{x("keywordHint")}</span>
                </label>
              </>
            )}

            {/* the label names the revenue pool this ad's sales land in */}
            <label className="mt-5 block border-t border-slate-100 pt-4">
              <span className="mb-1 block text-xs font-semibold text-slate-500">{x("bookLabel")}</span>
              <input
                className="input !py-1.5 text-sm"
                value={editing.bookLabel}
                placeholder={
                  editing.targetKind === "list"
                    ? (chosenList?.name ?? resolved?.list_name ?? editing.rawName)
                    : editing.targetKind === "link"
                    ? (resolved?.list_name ?? resolved?.product_name ?? editing.rawName)
                    : editing.rawName
                }
                onChange={(e) => setEditing({ ...editing, bookLabel: e.target.value })}
              />
            </label>

            <div className="mt-6 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEditing(null)}>
                {x("cancel")}
              </button>
              <button
                className="btn-primary"
                onClick={save}
                disabled={
                  saving ||
                  (editing.targetKind === "list" && !editing.listKey) ||
                  // a link is only saveable once it resolves to something real;
                  // otherwise it would record a connection measuring nothing
                  (editing.targetKind === "link" && !resolved?.list_key && !resolved?.sku) ||
                  (editing.targetKind === "book" && !editing.skus.length && !editing.keyword.trim())
                }
              >
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
