"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen, UploadCloud, Wand2, Image as ImageIcon, Send, RefreshCw,
  Megaphone, Trash2, ExternalLink, Search, Sparkles, Play, Pause, CheckCircle2, XCircle,
  Target, Users, Lightbulb, SplitSquareHorizontal, Repeat, Plus, Check,
} from "lucide-react";
import type { MarketingPlan, AdConfig } from "@/lib/marketing/director";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner, KpiCard, EmptyState } from "@/components/ui";
import { formatMoney, formatNumber, formatDateTime, cn } from "@/lib/utils";
import { parseEpub } from "@/lib/marketing/epub";
import {
  renderAsset, loadImage, ASSET_DIMS, ASSET_LABELS,
  type AssetFmt, type AssetStyle,
} from "@/lib/marketing/asset-engine";

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;

interface HostedBook { id: string; title: string; buyUrl: string | null; category: string | null }

interface PostInsights {
  impressions?: number; reach?: number; clicks?: number; reactions?: number;
  likes?: number; comments?: number; shares?: number; saved?: number; views?: number;
}

interface AdInfo {
  campaign_id?: string; adset_id?: string; ad_id?: string; daily_budget?: number;
  days?: number; status?: string;
  insights?: { spend?: number; impressions?: number; clicks?: number; results?: number };
}

interface MarketingPost {
  id: string;
  created_at: string;
  book_ref: string | null;
  book_title: string;
  buy_url: string | null;
  summary: string;
  hook: string;
  post_fb: string;
  post_ig: string;
  hashtags: string;
  research_notes: string;
  status: "draft" | "ready" | "published" | "failed";
  assets: { fmt: AssetFmt; path: string; url: string }[];
  channels: string[];
  fb_post_id: string | null;
  ig_media_id: string | null;
  ig_permalink: string | null;
  published_at: string | null;
  publish_error: string | null;
  insights: { fb?: PostInsights; ig?: PostInsights } | null;
  insights_at: string | null;
  ad: AdInfo | null;
}

type Tab = "create" | "posts" | "report";
type SourceMode = "library" | "epub" | "manual";

const STYLE_LABELS: Record<AssetStyle, { ar: string; en: string }> = {
  navy: { ar: "كحلي (الهوية)", en: "Navy (brand)" },
  paper: { ar: "ورقي فاتح", en: "Paper light" },
  teal: { ar: "أخضر مائي", en: "Teal" },
};

export default function MarketingPage() {
  const { t, lang } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>("create");

  // ---------- source ----------
  const [mode, setMode] = useState<SourceMode>("library");
  const [books, setBooks] = useState<HostedBook[]>([]);
  const [booksLoading, setBooksLoading] = useState(false);
  const [bookSearch, setBookSearch] = useState("");
  const [flipbookId, setFlipbookId] = useState<string | null>(null);
  const [selBooks, setSelBooks] = useState<HostedBook[]>([]);
  const [title, setTitle] = useState("");
  const [buyUrl, setBuyUrl] = useState("");
  const [manualText, setManualText] = useState("");
  const [epubText, setEpubText] = useState("");
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const epubRef = useRef<HTMLInputElement>(null);

  // ---------- AI ----------
  const [engine, setEngine] = useState<"builtin" | "claude">("builtin");
  const [variant, setVariant] = useState(0);
  const [usedEngine, setUsedEngine] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [research, setResearch] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [hook, setHook] = useState("");
  const [postFb, setPostFb] = useState("");
  const [postIg, setPostIg] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [researchNotes, setResearchNotes] = useState("");
  const [plan, setPlan] = useState<MarketingPlan | null>(null);
  const [bundleSugs, setBundleSugs] = useState<{ id: string; title: string }[]>([]);

  // ---------- save/assets/publish ----------
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [style, setStyle] = useState<AssetStyle>("navy");
  const [fmts, setFmts] = useState<AssetFmt[]>(["sq", "story", "link"]);
  const [previews, setPreviews] = useState<Partial<Record<AssetFmt, string>>>({});
  const [rendering, setRendering] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [assetUrls, setAssetUrls] = useState<{ fmt: AssetFmt; path: string; url: string }[]>([]);
  const [channels, setChannels] = useState<("fb" | "ig")[]>(["fb", "ig"]);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{ ok: boolean; errors: string[] } | null>(null);

  // ---------- posts list ----------
  const [posts, setPosts] = useState<MarketingPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [boostFor, setBoostFor] = useState<string | null>(null);
  const [boostBudget, setBoostBudget] = useState("200");
  const [boostDays, setBoostDays] = useState("7");
  const [boostBusy, setBoostBusy] = useState(false);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const loadPosts = useCallback(async () => {
    setPostsLoading(true);
    const { data } = await supabase.from("marketing_posts").select("*").order("created_at", { ascending: false }).limit(100);
    setPosts((data as MarketingPost[]) ?? []);
    setPostsLoading(false);
  }, [supabase]);

  useEffect(() => { loadPosts(); }, [loadPosts]);

  useEffect(() => {
    if (mode !== "library" || books.length || booksLoading) return;
    let cancelled = false;
    setBooksLoading(true);
    fetch("/api/flipbooks")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setBooks(((d.books ?? []) as { id: string; title: string; buyUrl: string | null; category: string | null }[])
          .map((b) => ({ id: b.id, title: b.title, buyUrl: b.buyUrl, category: b.category })));
      })
      .finally(() => { if (!cancelled) setBooksLoading(false); });
    return () => { cancelled = true; };
  }, [mode, books.length, booksLoading]);

  const filteredBooks = useMemo(() => {
    const q = bookSearch.trim().toLowerCase();
    if (!q) return books.slice(0, 40);
    return books.filter((b) => b.title.toLowerCase().includes(q)).slice(0, 40);
  }, [books, bookSearch]);

  // Click toggles the book in/out of the selection — one book is a normal
  // post, several books become a bundle/reading-list post (carousel ad).
  const applySelection = useCallback((next: HostedBook[]) => {
    setSelBooks(next);
    const first = next[0] ?? null;
    setFlipbookId(first?.id ?? null);
    setTitle(next.map((x) => x.title).join(" + "));
    setBuyUrl(first?.buyUrl ?? "");
    setCoverUrl(first ? `${SUPA}/storage/v1/object/public/flipbooks/${first.id}/cover.webp` : null);
  }, []);

  function pickBook(b: HostedBook) {
    const has = selBooks.some((x) => x.id === b.id);
    applySelection(has ? selBooks.filter((x) => x.id !== b.id) : [...selBooks, b]);
  }

  function addSuggested(s: { id: string; title: string }) {
    if (selBooks.some((x) => x.id === s.id)) return;
    const full = books.find((x) => x.id === s.id);
    applySelection([...selBooks, full ?? { id: s.id, title: s.title, buyUrl: null, category: null }]);
  }

  async function handleEpub(file: File) {
    setParsing(true);
    setGenError(null);
    try {
      const parsed = await parseEpub(file);
      setTitle(parsed.title);
      setEpubText(parsed.text);
      setFlipbookId(null);
      setSelBooks([]);
      setCoverUrl(parsed.coverBlob ? URL.createObjectURL(parsed.coverBlob) : null);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "EPUB parse failed");
    }
    setParsing(false);
    if (epubRef.current) epubRef.current.value = "";
  }

  async function generate(nextVariant?: number) {
    setGenerating(true);
    setGenError(null);
    setNotice(null);
    const v = nextVariant ?? variant;
    try {
      const res = await fetch("/api/marketing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flipbookIds: mode === "library" ? selBooks.map((b) => b.id) : undefined,
          titles: mode === "library" && selBooks.length ? selBooks.map((b) => b.title) : [title],
          text: mode === "epub" ? epubText : mode === "manual" ? manualText : undefined,
          title, buyUrl: buyUrl || undefined, instructions, research, lang,
          engine, variant: v,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message ?? d.error ?? "generation failed");
      setSummary(d.summary); setHook(d.hook); setPostFb(d.post_fb);
      setPostIg(d.post_ig); setHashtags(d.hashtags); setResearchNotes(d.research_notes ?? "");
      setPlan((d.plan as MarketingPlan) ?? null);
      setBundleSugs((d.bundleSuggestions as { id: string; title: string }[]) ?? []);
      setUsedEngine(d.engine ?? null); setNotice(d.notice ?? null); setVariant(v);
      setSavedId(null); setAssetUrls([]); setPreviews({}); setPublishResult(null);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "generation failed");
    }
    setGenerating(false);
  }

  async function saveDraft(): Promise<string | null> {
    if (savedId) {
      await supabase.from("marketing_posts").update({
        book_title: title, buy_url: buyUrl || null, summary, hook,
        post_fb: postFb, post_ig: postIg, hashtags, research_notes: researchNotes,
        plan: plan ?? null,
      }).eq("id", savedId);
      return savedId;
    }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("marketing_posts").insert({
      book_ref: flipbookId, book_title: title, buy_url: buyUrl || null,
      summary, hook, post_fb: postFb, post_ig: postIg, hashtags,
      research_notes: researchNotes, plan: plan ?? null, created_by: u.user?.id,
    }).select("id").single();
    setSaving(false);
    if (error || !data) { setGenError(error?.message ?? "save failed"); return null; }
    setSavedId(data.id);
    await loadPosts();
    return data.id;
  }

  const renderPreviews = useCallback(async () => {
    setRendering(true);
    try {
      let cover: HTMLImageElement | null = null;
      if (coverUrl) { try { cover = await loadImage(coverUrl); } catch { cover = null; } }
      const cta = buyUrl ? (lang === "en" ? "Order now — link in comments" : "اطلبه الآن — الرابط في التعليقات") : (lang === "en" ? "Order now from our store" : "اطلبه الآن من المتجر");
      const next: Partial<Record<AssetFmt, string>> = {};
      for (const fmt of fmts) {
        const blob = await renderAsset(fmt, { cover, title, hook: hook || summary.slice(0, 120), cta, style });
        next[fmt] = URL.createObjectURL(blob);
      }
      setPreviews(next);
    } finally {
      setRendering(false);
    }
  }, [coverUrl, buyUrl, lang, fmts, title, hook, summary, style]);

  async function uploadAssets() {
    const id = await saveDraft();
    if (!id) return;
    setUploading(true);
    try {
      const files = fmts.map((f) => `${f}.jpg`);
      const res = await fetch("/api/marketing/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: id, files }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "sign failed");
      const rows: { fmt: AssetFmt; path: string; url: string }[] = [];
      let cover: HTMLImageElement | null = null;
      if (coverUrl) { try { cover = await loadImage(coverUrl); } catch { cover = null; } }
      const cta = buyUrl ? (lang === "en" ? "Order now — link in comments" : "اطلبه الآن — الرابط في التعليقات") : (lang === "en" ? "Order now from our store" : "اطلبه الآن من المتجر");
      for (const up of d.uploads as { name: string; signedUrl: string; path: string; publicUrl: string }[]) {
        const fmt = up.name.replace(".jpg", "") as AssetFmt;
        const blob = await renderAsset(fmt, { cover, title, hook: hook || summary.slice(0, 120), cta, style });
        const put = await fetch(up.signedUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
        if (!put.ok) throw new Error(`upload failed (${up.name})`);
        rows.push({ fmt, path: up.path, url: up.publicUrl });
      }
      await supabase.from("marketing_posts").update({ assets: rows, status: "ready" }).eq("id", id);
      setAssetUrls(rows);
      await loadPosts();
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "asset upload failed");
    }
    setUploading(false);
  }

  async function publishNow() {
    const id = await saveDraft();
    if (!id) return;
    setPublishing(true);
    setPublishResult(null);
    try {
      const res = await fetch("/api/marketing/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: id, channels }),
      });
      const d = await res.json();
      if (!res.ok && d.message) throw new Error(d.message);
      setPublishResult({ ok: Boolean(d.ok), errors: d.errors ?? (d.error ? [d.error] : []) });
      await loadPosts();
      if (d.ok) setTab("posts");
    } catch (e) {
      setPublishResult({ ok: false, errors: [e instanceof Error ? e.message : "publish failed"] });
    }
    setPublishing(false);
  }

  // ---------- posts tab actions ----------
  async function syncInsights(postId?: string) {
    setSyncing(true);
    await fetch("/api/marketing/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(postId ? { postId } : {}),
    });
    await loadPosts();
    setSyncing(false);
  }

  async function boost(postId: string) {
    setBoostBusy(true);
    setRowError((p) => ({ ...p, [postId]: "" }));
    const res = await fetch("/api/marketing/ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "boost", postId, dailyBudget: Number(boostBudget), days: Number(boostDays) }),
    });
    const d = await res.json();
    if (!res.ok) setRowError((p) => ({ ...p, [postId]: d.message ?? d.error ?? "boost failed" }));
    else setBoostFor(null);
    await loadPosts();
    setBoostBusy(false);
  }

  async function adAction(postId: string, action: "activate" | "pause") {
    setRowError((p) => ({ ...p, [postId]: "" }));
    const res = await fetch("/api/marketing/ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, postId }),
    });
    const d = await res.json();
    if (!res.ok) setRowError((p) => ({ ...p, [postId]: d.message ?? d.error ?? "failed" }));
    await loadPosts();
  }

  async function removePost(postId: string) {
    if (!confirm(t("mktDeleteConfirm"))) return;
    await supabase.from("marketing_posts").delete().eq("id", postId);
    await loadPosts();
  }

  // ---------- report ----------
  const report = useMemo(() => {
    const published = posts.filter((p) => p.status === "published");
    let reach = 0, engagement = 0, spend = 0, results = 0;
    for (const p of published) {
      const fb = p.insights?.fb ?? {};
      const ig = p.insights?.ig ?? {};
      reach += (fb.reach ?? fb.impressions ?? 0) + (ig.reach ?? 0);
      engagement += (fb.reactions ?? 0) + (fb.comments ?? 0) + (fb.shares ?? 0) + (fb.clicks ?? 0)
        + (ig.likes ?? 0) + (ig.comments ?? 0) + (ig.shares ?? 0) + (ig.saved ?? 0);
      spend += p.ad?.insights?.spend ?? 0;
      results += p.ad?.insights?.results ?? 0;
    }
    return { published: published.length, reach, engagement, spend, results };
  }, [posts]);

  const canGenerate = Boolean(title) && (mode !== "manual" || manualText.length > 50) && !generating;
  const hasCopy = Boolean(postFb || postIg);

  const statusChip = (s: MarketingPost["status"]) => {
    const map = {
      draft: "bg-slate-100 text-slate-600",
      ready: "bg-brand-50 text-brand-700",
      published: "bg-emerald-100 text-emerald-700",
      failed: "bg-red-100 text-red-700",
    } as const;
    const label = { draft: t("mktDraft"), ready: t("mktReady"), published: t("mktPublished"), failed: t("mktFailed") }[s];
    return <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", map[s])}>{label}</span>;
  };

  return (
    <div>
      <PageHeader
        title={t("marketing")}
        subtitle={t("marketingSubtitle")}
        actions={
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {(["create", "posts", "report"] as Tab[]).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={cn("rounded-md px-4 py-1.5 text-sm font-semibold", tab === k ? "bg-white shadow text-brand-700" : "text-slate-500 hover:text-slate-700")}
              >
                {k === "create" ? t("mktTabCreate") : k === "posts" ? t("mktTabPosts") : t("mktTabReport")}
              </button>
            ))}
          </div>
        }
      />

      {/* ============ CREATE ============ */}
      {tab === "create" && (
        <div className="space-y-6 max-w-4xl">
          {/* 1 — source */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center gap-2 font-bold text-brand-700"><BookOpen size={18} />1. {t("mktSourceTitle")}</div>
            <div className="flex flex-wrap gap-2">
              {([["library", t("mktSourceLibrary")], ["epub", t("mktSourceEpub")], ["manual", t("mktSourceManual")]] as [SourceMode, string][]).map(([k, label]) => (
                <button key={k} onClick={() => setMode(k)}
                  className={cn("rounded-lg border px-3 py-1.5 text-sm font-semibold", mode === k ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500 hover:border-slate-300")}>
                  {label}
                </button>
              ))}
            </div>

            {mode === "library" && (
              <div className="space-y-3">
                <div className="relative">
                  <Search size={15} className="absolute top-2.5 start-3 text-slate-400" />
                  <input className="input !ps-9" placeholder={t("mktSearchBook")} value={bookSearch} onChange={(e) => setBookSearch(e.target.value)} />
                </div>
                {booksLoading ? <Spinner /> : (
                  <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto md:grid-cols-3">
                    {filteredBooks.map((b) => {
                      const sel = selBooks.some((x) => x.id === b.id);
                      return (
                        <button key={b.id} onClick={() => pickBook(b)}
                          className={cn("relative flex items-center gap-2 rounded-lg border p-2 text-start text-xs", sel ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:border-slate-300")}>
                          {sel && <span className="absolute top-1 end-1 rounded-full bg-brand-600 p-0.5 text-white"><Check size={10} /></span>}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`${SUPA}/storage/v1/object/public/flipbooks/${b.id}/cover.webp`} alt="" className="h-12 w-9 rounded object-cover bg-slate-100"
                            onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
                          <span className="line-clamp-2 font-medium">{b.title}</span>
                        </button>
                      );
                    })}
                    {!filteredBooks.length && <div className="col-span-full text-sm text-slate-400">{t("mktNoBooks")}</div>}
                  </div>
                )}
                {selBooks.length > 1 && (
                  <div className="rounded-lg bg-brand-50 border border-brand-100 px-3 py-2 text-xs text-brand-800">
                    📚 {t("mktBundleMode")} ({selBooks.length})
                  </div>
                )}
                {bundleSugs.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-500">💡 {t("mktBundleSuggest")}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {bundleSugs.filter((s) => !selBooks.some((x) => x.id === s.id)).map((s) => (
                        <button key={s.id} onClick={() => addSuggested(s)}
                          className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-brand-400 hover:text-brand-700">
                          <Plus size={11} />{s.title.slice(0, 30)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {mode === "epub" && (
              <div onClick={() => epubRef.current?.click()}
                className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-8 text-center hover:border-brand-400">
                <UploadCloud className="h-9 w-9 text-brand-500" />
                <div className="text-sm font-semibold text-slate-600">{parsing ? t("mktParsing") : t("mktDropEpub")}</div>
                {epubText && <div className="text-xs text-emerald-600">{t("mktEpubLoaded")} — {formatNumber(epubText.length)} {t("mktChars")}</div>}
                <input ref={epubRef} type="file" accept=".epub" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleEpub(f); }} />
              </div>
            )}

            {mode === "manual" && (
              <textarea className="input min-h-32" placeholder={t("mktPasteText")} value={manualText} onChange={(e) => setManualText(e.target.value)} />
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">{t("mktBookTitle")}</label>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">{t("mktBuyUrl")}</label>
                <input className="input" dir="ltr" placeholder="https://nahdetmisrbookstore.com/..." value={buyUrl} onChange={(e) => setBuyUrl(e.target.value)} />
              </div>
            </div>
            {coverUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={coverUrl} alt="cover" className="h-24 rounded-lg border border-slate-200 object-cover" onError={() => setCoverUrl(null)} />
            )}
          </div>

          {/* 2 — AI */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center gap-2 font-bold text-brand-700"><Sparkles size={18} />2. {t("mktAiTitle")}</div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setEngine("builtin")}
                className={cn("rounded-lg border px-3 py-1.5 text-sm font-semibold", engine === "builtin" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500 hover:border-slate-300")}>
                {t("mktEngineFree")}
              </button>
              <button onClick={() => setEngine("claude")}
                className={cn("rounded-lg border px-3 py-1.5 text-sm font-semibold", engine === "claude" ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500 hover:border-slate-300")}>
                {t("mktEngineClaude")}
              </button>
            </div>
            {engine === "builtin" && <p className="text-xs text-emerald-700">{t("mktEngineFreeHint")}</p>}
            {engine === "claude" && (
              <>
                <textarea className="input" placeholder={t("mktInstructionsHint")} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={research} onChange={(e) => setResearch(e.target.checked)} />
                  {t("mktResearchToggle")}
                </label>
              </>
            )}
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={!canGenerate} onClick={() => generate()}>
                <Wand2 size={16} />
                {generating ? t("mktGenerating") : t("mktGenerate")}
              </button>
              {hasCopy && usedEngine === "builtin" && (
                <button className="btn-secondary" disabled={generating} onClick={() => generate(variant + 1)}>
                  <RefreshCw size={15} />
                  {t("mktRegenerate")}
                </button>
              )}
            </div>
            {notice && <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">{notice}</div>}
            {genError && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{genError}</div>}

            {hasCopy && (
              <div className="space-y-3 border-t border-slate-100 pt-4">
                {researchNotes && (
                  <div className="rounded-lg bg-brand-50 border border-brand-100 px-3 py-2 text-xs text-brand-800 whitespace-pre-wrap">
                    <b>{t("mktResearchNotes")}:</b> {researchNotes}
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">{t("mktHook")}</label>
                  <input className="input" value={hook} onChange={(e) => setHook(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">{t("mktSummary")}</label>
                  <textarea className="input min-h-20" value={summary} onChange={(e) => setSummary(e.target.value)} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">Facebook</label>
                    <textarea className="input min-h-44" value={postFb} onChange={(e) => setPostFb(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">Instagram</label>
                    <textarea className="input min-h-44" value={postIg} onChange={(e) => setPostIg(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">{t("mktHashtags")}</label>
                  <textarea className="input min-h-16" dir="auto" value={hashtags} onChange={(e) => setHashtags(e.target.value)} />
                </div>
                <button className="btn-secondary" onClick={saveDraft} disabled={saving}>
                  {savedId ? t("mktSaved") : saving ? "..." : t("mktSaveDraft")}
                </button>
              </div>
            )}
          </div>

          {/* Marketing director's plan */}
          {plan && <DirectorPlan plan={plan} />}

          {/* 3 — assets */}
          {hasCopy && (
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2 font-bold text-brand-700"><ImageIcon size={18} />3. {t("mktAssetsTitle")}</div>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex gap-2">
                  {(Object.keys(STYLE_LABELS) as AssetStyle[]).map((s) => (
                    <button key={s} onClick={() => setStyle(s)}
                      className={cn("rounded-lg border px-3 py-1.5 text-xs font-semibold", style === s ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500")}>
                      {STYLE_LABELS[s][lang]}
                    </button>
                  ))}
                </div>
                <div className="flex gap-3 text-xs text-slate-600">
                  {(Object.keys(ASSET_DIMS) as AssetFmt[]).map((f) => (
                    <label key={f} className="flex items-center gap-1.5">
                      <input type="checkbox" checked={fmts.includes(f)}
                        onChange={(e) => setFmts((p) => e.target.checked ? [...p, f] : p.filter((x) => x !== f))} />
                      {ASSET_LABELS[f][lang]}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={renderPreviews} disabled={rendering || !fmts.length}>
                  {rendering ? "..." : t("mktPreview")}
                </button>
                <button className="btn-primary" onClick={uploadAssets} disabled={uploading || !fmts.length}>
                  <UploadCloud size={16} />
                  {uploading ? t("mktUploading") : t("mktGenerateAssets")}
                </button>
              </div>
              {Object.keys(previews).length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {(Object.entries(previews) as [AssetFmt, string][]).map(([f, url]) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img key={f} src={url} alt={f} className={cn("rounded-lg border border-slate-200 shadow-sm", f === "story" ? "h-64" : "h-44")} />
                  ))}
                </div>
              )}
              {assetUrls.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 size={16} />{t("mktAssetsReady")}</div>
              )}
            </div>
          )}

          {/* 4 — publish */}
          {hasCopy && (
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2 font-bold text-brand-700"><Send size={18} />4. {t("mktPublishTitle")}</div>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={channels.includes("fb")}
                    onChange={(e) => setChannels((p) => e.target.checked ? [...p, "fb"] : p.filter((c) => c !== "fb"))} />
                  Facebook
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={channels.includes("ig")}
                    onChange={(e) => setChannels((p) => e.target.checked ? [...p, "ig"] : p.filter((c) => c !== "ig"))} />
                  Instagram
                </label>
              </div>
              <p className="text-xs text-slate-400">{t("mktPublishHint")}</p>
              <button className="btn-primary" onClick={publishNow} disabled={publishing || !channels.length}>
                <Send size={16} />
                {publishing ? t("mktPublishing") : t("mktPublishNow")}
              </button>
              {publishResult && (
                <div className={cn("flex items-start gap-2 rounded-lg px-3 py-2 text-sm border",
                  publishResult.ok ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-700")}>
                  {publishResult.ok ? <CheckCircle2 size={16} className="mt-0.5" /> : <XCircle size={16} className="mt-0.5" />}
                  <span>{publishResult.ok ? t("mktPublishedOk") : ""} {publishResult.errors.join(" — ")}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ============ POSTS ============ */}
      {tab === "posts" && (
        postsLoading ? <Spinner /> : posts.length === 0 ? <EmptyState message={t("mktNoPosts")} /> : (
          <div className="space-y-3">
            <div className="flex justify-end">
              <button className="btn-secondary" onClick={() => syncInsights()} disabled={syncing}>
                <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
                {t("mktSyncInsights")}
              </button>
            </div>
            {posts.map((p) => {
              const fb = p.insights?.fb;
              const ig = p.insights?.ig;
              return (
                <div key={p.id} className="card p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    {p.assets?.[0] && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={p.assets[0].url} alt="" className="h-16 w-16 rounded-lg object-cover border border-slate-200" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold">{p.book_title || "—"}</span>
                        {statusChip(p.status)}
                        {p.channels?.includes("fb") && <span className="rounded bg-blue-50 px-1.5 text-[10px] font-bold text-blue-700">FB</span>}
                        {p.channels?.includes("ig") && <span className="rounded bg-pink-50 px-1.5 text-[10px] font-bold text-pink-700">IG</span>}
                        {p.ad?.ad_id && (
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold",
                            p.ad.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                            AD {p.ad.status}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400">{formatDateTime(p.created_at)}</div>
                      {p.publish_error && <div className="mt-1 text-xs text-red-600">{p.publish_error}</div>}
                      {rowError[p.id] && <div className="mt-1 text-xs text-red-600">{rowError[p.id]}</div>}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                      {fb && (
                        <div>
                          <div className="font-bold text-slate-400">Facebook</div>
                          <div>{t("mktReach")}: {formatNumber(fb.reach ?? fb.impressions ?? 0)} · ❤ {formatNumber(fb.reactions ?? 0)} · 💬 {formatNumber(fb.comments ?? 0)} · ↗ {formatNumber(fb.shares ?? 0)}</div>
                        </div>
                      )}
                      {ig && (
                        <div>
                          <div className="font-bold text-slate-400">Instagram</div>
                          <div>{t("mktReach")}: {formatNumber(ig.reach ?? 0)} · ❤ {formatNumber(ig.likes ?? 0)} · 💬 {formatNumber(ig.comments ?? 0)}</div>
                        </div>
                      )}
                      {p.ad?.insights && (
                        <div>
                          <div className="font-bold text-slate-400">{t("mktAd")}</div>
                          <div>{t("mktSpend")}: {formatMoney(p.ad.insights.spend ?? 0, lang)} · {t("mktResults")}: {formatNumber(p.ad.insights.results ?? 0)}</div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {p.fb_post_id && (
                        <a className="rounded p-1.5 text-slate-400 hover:bg-slate-100" target="_blank" rel="noopener noreferrer"
                          href={`https://www.facebook.com/${p.fb_post_id}`} title="Facebook"><ExternalLink size={15} /></a>
                      )}
                      {p.ig_permalink && (
                        <a className="rounded p-1.5 text-pink-500 hover:bg-pink-50" target="_blank" rel="noopener noreferrer"
                          href={p.ig_permalink} title="Instagram"><ExternalLink size={15} /></a>
                      )}
                      {p.status === "published" && (
                        <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100" title={t("mktSyncInsights")} onClick={() => syncInsights(p.id)}>
                          <RefreshCw size={15} />
                        </button>
                      )}
                      {p.fb_post_id && !p.ad?.ad_id && (
                        <button className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => setBoostFor(boostFor === p.id ? null : p.id)}>
                          <Megaphone size={14} />{t("mktBoost")}
                        </button>
                      )}
                      {p.ad?.ad_id && p.ad.status !== "ACTIVE" && (
                        <button className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50" title={t("mktActivateAd")} onClick={() => adAction(p.id, "activate")}>
                          <Play size={15} />
                        </button>
                      )}
                      {p.ad?.ad_id && p.ad.status === "ACTIVE" && (
                        <button className="rounded p-1.5 text-amber-600 hover:bg-amber-50" title={t("mktPauseAd")} onClick={() => adAction(p.id, "pause")}>
                          <Pause size={15} />
                        </button>
                      )}
                      <button className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => removePost(p.id)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  {boostFor === p.id && (
                    <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 border border-slate-200 p-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-500">{t("mktDailyBudget")}</label>
                        <input className="input !py-1.5 w-28" dir="ltr" type="number" min={1} value={boostBudget} onChange={(e) => setBoostBudget(e.target.value)} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-500">{t("mktDays")}</label>
                        <input className="input !py-1.5 w-20" dir="ltr" type="number" min={1} max={90} value={boostDays} onChange={(e) => setBoostDays(e.target.value)} />
                      </div>
                      <button className="btn-primary !py-1.5" disabled={boostBusy} onClick={() => boost(p.id)}>
                        <Megaphone size={15} />{boostBusy ? "..." : t("mktCreateAd")}
                      </button>
                      <p className="text-[11px] text-slate-400 basis-full">{t("mktBoostHint")}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ============ REPORT ============ */}
      {tab === "report" && (
        <div className="space-y-6">
          <div className="flex justify-end">
            <button className="btn-secondary" onClick={() => syncInsights()} disabled={syncing}>
              <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
              {t("mktSyncInsights")}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <KpiCard label={t("mktPublishedPosts")} value={formatNumber(report.published)} accent="slate" />
            <KpiCard label={t("mktReach")} value={formatNumber(report.reach)} accent="green" />
            <KpiCard label={t("mktEngagement")} value={formatNumber(report.engagement)} accent="green" />
            <KpiCard label={t("mktAdSpend")} value={formatMoney(report.spend, lang)} accent="red" />
            <KpiCard label={t("mktResults")} value={formatNumber(report.results)} accent="slate" />
          </div>
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t("mktBookTitle")}</th>
                  <th>{t("status")}</th>
                  <th>FB {t("mktReach")}</th>
                  <th>FB ❤/💬/↗</th>
                  <th>IG {t("mktReach")}</th>
                  <th>IG ❤/💬</th>
                  <th>{t("mktSpend")}</th>
                  <th>{t("mktResults")}</th>
                  <th>{t("mktLastSync")}</th>
                </tr>
              </thead>
              <tbody>
                {posts.filter((p) => p.status === "published").map((p) => {
                  const fb = p.insights?.fb ?? {};
                  const ig = p.insights?.ig ?? {};
                  return (
                    <tr key={p.id}>
                      <td className="!whitespace-normal max-w-[220px] font-medium">{p.book_title}</td>
                      <td>{statusChip(p.status)}</td>
                      <td>{formatNumber(fb.reach ?? fb.impressions ?? 0)}</td>
                      <td>{formatNumber(fb.reactions ?? 0)}/{formatNumber(fb.comments ?? 0)}/{formatNumber(fb.shares ?? 0)}</td>
                      <td>{formatNumber(ig.reach ?? 0)}</td>
                      <td>{formatNumber(ig.likes ?? 0)}/{formatNumber(ig.comments ?? 0)}</td>
                      <td>{p.ad?.insights ? formatMoney(p.ad.insights.spend ?? 0, lang) : "—"}</td>
                      <td>{p.ad?.insights ? formatNumber(p.ad.insights.results ?? 0) : "—"}</td>
                      <td className="text-xs text-slate-400">{p.insights_at ? formatDateTime(p.insights_at) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">{t("mktReportHint")}</p>
        </div>
      )}
    </div>
  );
}

// The marketing-director deliverable: persona, go-to-market decision, full
// per-platform media-buyer configurations, retargeting stack and A/B tests.
function DirectorPlan({ plan }: { plan: MarketingPlan }) {
  const { t } = useLang();
  const [open, setOpen] = useState(0);
  const mode = plan.decision?.mode ?? "both";
  const modeStyle =
    mode === "ad" ? "bg-red-50 border-red-200 text-red-700"
    : mode === "organic" ? "bg-emerald-50 border-emerald-200 text-emerald-700"
    : "bg-amber-50 border-amber-200 text-amber-800";
  const modeLabel = mode === "ad" ? t("mktDecisionAd") : mode === "organic" ? t("mktDecisionOrganic") : t("mktDecisionBoth");

  const row = (label: string, value?: string) =>
    value ? (
      <div className="grid grid-cols-[110px_1fr] gap-2 text-xs">
        <div className="font-semibold text-slate-500">{label}</div>
        <div className="text-slate-700 whitespace-pre-wrap">{value}</div>
      </div>
    ) : null;

  return (
    <div className="card p-5 space-y-5">
      <div className="flex items-center gap-2 font-bold text-brand-700">
        <Target size={18} />
        {t("mktPlanTitle")}
      </div>

      {/* Decision */}
      <div className={cn("rounded-lg border px-4 py-3 text-sm", modeStyle)}>
        <div className="mb-1 font-bold">{modeLabel}</div>
        <div className="text-xs leading-relaxed">{plan.decision?.reason}</div>
      </div>

      {/* Persona */}
      {plan.persona && (
        <div className="rounded-lg border border-slate-200 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <Users size={15} />
            {t("mktPersonaTitle")}: {plan.persona.name}
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {plan.persona.age && <span className="rounded-full bg-slate-100 px-2.5 py-0.5">{t("mktAge")}: {plan.persona.age}</span>}
            {plan.persona.gender && <span className="rounded-full bg-slate-100 px-2.5 py-0.5">{plan.persona.gender}</span>}
          </div>
          <p className="text-xs leading-relaxed text-slate-600">{plan.persona.description}</p>
          <div className="grid gap-3 md:grid-cols-2 text-xs">
            {plan.persona.pains?.length > 0 && (
              <div>
                <div className="mb-1 font-semibold text-red-600">{t("mktPains")}</div>
                <ul className="space-y-0.5 text-slate-600">{plan.persona.pains.map((x, i) => <li key={i}>• {x}</li>)}</ul>
              </div>
            )}
            {plan.persona.motivations?.length > 0 && (
              <div>
                <div className="mb-1 font-semibold text-emerald-600">{t("mktMotivations")}</div>
                <ul className="space-y-0.5 text-slate-600">{plan.persona.motivations.map((x, i) => <li key={i}>• {x}</li>)}</ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Platform configs */}
      <div className="space-y-2">
        {(plan.platforms ?? []).map((p: AdConfig, i: number) => (
          <div key={i} className="rounded-lg border border-slate-200">
            <button className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-semibold text-slate-700"
              onClick={() => setOpen(open === i ? -1 : i)}>
              <span className="flex items-center gap-2"><Megaphone size={14} className="text-brand-500" />{p.platform}</span>
              <span className="text-slate-400">{open === i ? "−" : "+"}</span>
            </button>
            {open === i && (
              <div className="space-y-2 border-t border-slate-100 px-4 py-3">
                {row(t("mktObjective"), p.objective)}
                {row(t("mktAge"), p.age)}
                {row(t("mktGender"), p.gender)}
                {row(t("mktGeo"), p.geo)}
                {p.interests?.length > 0 && (
                  <div className="grid grid-cols-[110px_1fr] gap-2 text-xs">
                    <div className="font-semibold text-slate-500">{t("mktInterests")}</div>
                    <div className="flex flex-wrap gap-1">
                      {p.interests.map((x, j) => <span key={j} className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700" dir="auto">{x}</span>)}
                    </div>
                  </div>
                )}
                {row(t("mktPlacements"), p.placements)}
                {row(t("mktBudget"), p.budget)}
                {row(t("mktDuration"), p.duration)}
                {row(t("mktCreative"), p.creative)}
                {row(t("mktCta"), p.cta)}
                {row(t("mktSchedule"), p.schedule)}
                {p.tips?.length > 0 && (
                  <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
                    <div className="mb-1 flex items-center gap-1 font-semibold"><Lightbulb size={12} />{t("mktTips")}</div>
                    <ul className="space-y-0.5">{p.tips.map((x, j) => <li key={j}>• {x}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Retargeting + A/B */}
      <div className="grid gap-3 md:grid-cols-2">
        {plan.retargeting?.length > 0 && (
          <div className="rounded-lg border border-slate-200 p-3 text-xs">
            <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-slate-700"><Repeat size={13} />{t("mktRetargetingTitle")}</div>
            <ul className="space-y-1 text-slate-600">{plan.retargeting.map((x, i) => <li key={i}>• {x}</li>)}</ul>
          </div>
        )}
        {plan.abTests?.length > 0 && (
          <div className="rounded-lg border border-slate-200 p-3 text-xs">
            <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-slate-700"><SplitSquareHorizontal size={13} />{t("mktAbTitle")}</div>
            <ul className="space-y-1 text-slate-600">{plan.abTests.map((x, i) => <li key={i}>• {x}</li>)}</ul>
          </div>
        )}
      </div>

      {/* Multi-book idea */}
      {plan.multiBook && (
        <div className="rounded-lg bg-brand-50 border border-brand-100 px-4 py-3 text-xs text-brand-800">
          <b>📚 {t("mktMultiBookTitle")}:</b> {plan.multiBook}
        </div>
      )}
    </div>
  );
}
