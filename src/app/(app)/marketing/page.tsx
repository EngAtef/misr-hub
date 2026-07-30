"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen, UploadCloud, Wand2, Image as ImageIcon, Send, RefreshCw,
  Megaphone, Trash2, ExternalLink, Search, Sparkles, Play, Pause, CheckCircle2, XCircle,
  Target, Users, Lightbulb, SplitSquareHorizontal, Repeat, Plus, Check, X,
} from "lucide-react";
import type { MarketingPlan, AdConfig } from "@/lib/marketing/director";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner, KpiCard, EmptyState } from "@/components/ui";
import { formatMoney, formatNumber, formatDateTime, cn } from "@/lib/utils";
import { parseEpub } from "@/lib/marketing/epub";
import {
  renderAsset, loadImage, ASSET_DIMS, ASSET_LABELS, STYLE_NAMES, LAYOUT_NAMES,
  type AssetFmt, type AssetStyle, type AssetLayout,
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
  post_wa: string | null;
  ab_group: string | null;
  read_url: string | null;
}

interface AdvisorPick {
  sku: string; product_name: string; category: string | null;
  units_30: number; units_prev_30: number; trend_pct: number | null;
  revenue_30: number; ecom_stock: number; cover_days: number | null;
  margin_pct: number | null; tags: string[]; score: number;
}
interface OccasionRow {
  key: string; name: string; date: string; daysLeft: number; prepDays: number;
  inPrepWindow: boolean; genres: string[]; advice: string; approximate: boolean;
}
interface AdvisorData {
  picks: AdvisorPick[];
  hours: { h: number; orders: number }[];
  dows: { d: number; orders: number }[];
  occasions: OccasionRow[];
}
interface PackDay { day: number; theme: string; post_fb: string; post_ig: string }
interface ImpactData {
  before_orders: number; before_units: number; before_revenue: number;
  after_orders: number; after_units: number; after_revenue: number; days: number;
}

type Tab = "create" | "advisor" | "posts" | "report";
type SourceMode = "library" | "epub" | "manual";


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
  const [postLang, setPostLang] = useState<"ar" | "en">("ar"); // post copy language, independent of the UI
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
  const [postWa, setPostWa] = useState("");
  const [freeChapter, setFreeChapter] = useState(false);
  const [pack, setPack] = useState<PackDay[] | null>(null);
  const [packLoading, setPackLoading] = useState(false);

  // ---------- advisor ----------
  const [advisor, setAdvisor] = useState<AdvisorData | null>(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [impact, setImpact] = useState<Record<string, ImpactData | "loading" | "error">>({});

  // ---------- save/assets/publish ----------
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [style, setStyle] = useState<AssetStyle>("navy");
  const [layout, setLayout] = useState<AssetLayout>("classic");
  const [badge, setBadge] = useState("");
  // Ready-made designs (Canva exports / designer files) per format — these
  // replace the generated design for that format everywhere downstream.
  const [custom, setCustom] = useState<Partial<Record<AssetFmt, File>>>({});
  const customRef = useRef<HTMLInputElement>(null);
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
    if (tab !== "advisor" || advisor || advisorLoading) return;
    setAdvisorLoading(true);
    fetch(`/api/marketing/advisor?lang=${lang}`)
      .then((r) => r.json())
      .then((d) => setAdvisor(d as AdvisorData))
      .finally(() => setAdvisorLoading(false));
  }, [tab, advisor, advisorLoading, lang]);

  // Occasions text is localized server-side — refetch on UI language switch.
  useEffect(() => { setAdvisor(null); }, [lang]);

  // The free-first-chapter reader link (library books only), UTM-tagged so
  // GA4 shows the funnel.
  const readUrl = useMemo(() => {
    if (!freeChapter || !flipbookId || typeof window === "undefined") return "";
    return `${window.location.origin}/reader/${flipbookId}?utm_source=social&utm_medium=organic&utm_campaign=mkt-free-chapter`;
  }, [freeChapter, flipbookId]);

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

  // A/B winners: within each ab_group, the post with the highest weighted
  // engagement (once insights exist) gets the trophy.
  const abWinners = useMemo(() => {
    const score = (p: MarketingPost) => {
      const f = p.insights?.fb ?? {};
      const g = p.insights?.ig ?? {};
      return (f.reach ?? f.impressions ?? 0) + (f.reactions ?? 0) * 10 + (f.comments ?? 0) * 20 + (f.shares ?? 0) * 30
        + (g.reach ?? 0) + (g.likes ?? 0) * 10 + (g.comments ?? 0) * 20;
    };
    const groups = new Map<string, MarketingPost[]>();
    for (const p of posts) {
      if (!p.ab_group) continue;
      groups.set(p.ab_group, [...(groups.get(p.ab_group) ?? []), p]);
    }
    const winners = new Set<string>();
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const best = list.reduce((a, b) => (score(b) > score(a) ? b : a));
      if (score(best) > 0) winners.add(best.id);
    }
    return winners;
  }, [posts]);

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
          title, buyUrl: buyUrl || undefined, readUrl: readUrl || undefined,
          instructions, research, lang: postLang, planLang: lang,
          engine, variant: v,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message ?? d.error ?? "generation failed");
      setSummary(d.summary); setHook(d.hook); setPostFb(d.post_fb);
      setPostIg(d.post_ig); setPostWa(d.post_wa ?? ""); setHashtags(d.hashtags);
      setResearchNotes(d.research_notes ?? "");
      setPlan((d.plan as MarketingPlan) ?? null);
      setBundleSugs((d.bundleSuggestions as { id: string; title: string }[]) ?? []);
      setUsedEngine(d.engine ?? null); setNotice(d.notice ?? null); setVariant(v);
      setSavedId(null); setAssetUrls([]); setPreviews({}); setPublishResult(null); setPack(null);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "generation failed");
    }
    setGenerating(false);
  }

  async function saveDraft(): Promise<string | null> {
    if (savedId) {
      await supabase.from("marketing_posts").update({
        book_title: title, buy_url: buyUrl || null, summary, hook,
        post_fb: postFb, post_ig: postIg, post_wa: postWa, hashtags,
        research_notes: researchNotes, plan: plan ?? null, read_url: readUrl || null,
      }).eq("id", savedId);
      return savedId;
    }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("marketing_posts").insert({
      book_ref: flipbookId, book_title: title, buy_url: buyUrl || null,
      summary, hook, post_fb: postFb, post_ig: postIg, post_wa: postWa, hashtags,
      research_notes: researchNotes, plan: plan ?? null, read_url: readUrl || null,
      created_by: u.user?.id,
    }).select("id").single();
    setSaving(false);
    if (error || !data) { setGenError(error?.message ?? "save failed"); return null; }
    setSavedId(data.id);
    await loadPosts();
    return data.id;
  }

  // Re-encode an uploaded design to the exact Meta dimensions (cover-fit crop).
  const fileToAsset = useCallback(async (file: File, fmt: AssetFmt): Promise<Blob> => {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const [W, H] = ASSET_DIMS[fmt];
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const x = c.getContext("2d")!;
      const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const sw = W / s, sh = H / s;
      x.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, W, H);
      return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.92));
    } finally {
      URL.revokeObjectURL(url);
    }
  }, []);

  // Assign uploaded files to formats by aspect ratio (tall→story, wide→link,
  // square-ish→sq); collisions fall back to the first free selected format.
  async function pickCustomFiles(files: FileList) {
    const next = { ...custom };
    for (const f of Array.from(files)) {
      const url = URL.createObjectURL(f);
      try {
        const img = await loadImage(url);
        const r = img.naturalWidth / img.naturalHeight;
        let fmt: AssetFmt = r > 1.4 ? "link" : r < 0.72 ? "story" : "sq";
        if (next[fmt]) fmt = (fmts.find((k) => !next[k]) ?? fmt);
        next[fmt] = f;
      } catch { /* skip unreadable file */ }
      URL.revokeObjectURL(url);
    }
    setCustom(next);
    setPreviews({});
    setAssetUrls([]);
  }

  const renderPreviews = useCallback(async () => {
    setRendering(true);
    try {
      let cover: HTMLImageElement | null = null;
      if (coverUrl) { try { cover = await loadImage(coverUrl); } catch { cover = null; } }
      const cta = buyUrl ? (postLang === "en" ? "Order now — link in comments" : "اطلبه الآن — الرابط في التعليقات") : (postLang === "en" ? "Order now from our store" : "اطلبه الآن من المتجر");
      const next: Partial<Record<AssetFmt, string>> = {};
      for (const fmt of fmts) {
        const blob = custom[fmt]
          ? await fileToAsset(custom[fmt]!, fmt)
          : await renderAsset(fmt, { cover, title, hook: hook || summary.slice(0, 120), cta, style, layout, badge: badge || undefined });
        next[fmt] = URL.createObjectURL(blob);
      }
      setPreviews(next);
    } finally {
      setRendering(false);
    }
  }, [coverUrl, buyUrl, postLang, fmts, title, hook, summary, style, layout, badge, custom, fileToAsset]);

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
      const cta = buyUrl ? (postLang === "en" ? "Order now — link in comments" : "اطلبه الآن — الرابط في التعليقات") : (postLang === "en" ? "Order now from our store" : "اطلبه الآن من المتجر");
      for (const up of d.uploads as { name: string; signedUrl: string; path: string; publicUrl: string }[]) {
        const fmt = up.name.replace(".jpg", "") as AssetFmt;
        const blob = custom[fmt]
          ? await fileToAsset(custom[fmt]!, fmt)
          : await renderAsset(fmt, { cover, title, hook: hook || summary.slice(0, 120), cta, style, layout, badge: badge || undefined });
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

  // 7-day campaign pack (free engine)
  async function loadPack() {
    setPackLoading(true);
    try {
      const res = await fetch("/api/marketing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pack: true,
          flipbookIds: mode === "library" ? selBooks.map((b) => b.id) : undefined,
          text: mode === "epub" ? epubText : mode === "manual" ? manualText : undefined,
          title, buyUrl: buyUrl || undefined, readUrl: readUrl || undefined, lang: postLang,
        }),
      });
      const d = await res.json();
      if (res.ok && d.pack) setPack(d.pack as PackDay[]);
    } finally {
      setPackLoading(false);
    }
  }

  // A/B publish: A = the current copy, B = the next template variant. Both
  // share an ab_group and B reuses A's uploaded assets, so the only variable
  // is the wording — a clean test.
  async function abPublish() {
    const id = await saveDraft();
    if (!id) return;
    setPublishing(true);
    setPublishResult(null);
    try {
      const res = await fetch("/api/marketing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flipbookIds: mode === "library" ? selBooks.map((b) => b.id) : undefined,
          titles: mode === "library" && selBooks.length ? selBooks.map((b) => b.title) : [title],
          text: mode === "epub" ? epubText : mode === "manual" ? manualText : undefined,
          title, buyUrl: buyUrl || undefined, readUrl: readUrl || undefined,
          lang: postLang, planLang: lang,
          engine: "builtin", variant: variant + 1,
        }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? "variant generation failed");

      const abGroup = crypto.randomUUID();
      await supabase.from("marketing_posts").update({ ab_group: abGroup }).eq("id", id);
      const { data: u } = await supabase.auth.getUser();
      const { data: rowB, error } = await supabase.from("marketing_posts").insert({
        book_ref: flipbookId, book_title: `${title} (B)`, buy_url: buyUrl || null,
        summary: b.summary, hook: b.hook, post_fb: b.post_fb, post_ig: b.post_ig,
        post_wa: b.post_wa ?? "", hashtags: b.hashtags, plan: plan ?? null,
        read_url: readUrl || null, ab_group: abGroup, assets: assetUrls,
        status: assetUrls.length ? "ready" : "draft", created_by: u.user?.id,
      }).select("id").single();
      if (error || !rowB) throw new Error(error?.message ?? "B draft failed");

      const errors: string[] = [];
      for (const pid of [id, rowB.id]) {
        const pr = await fetch("/api/marketing/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postId: pid, channels }),
        });
        const pd = await pr.json();
        if (!pd.ok) errors.push(...(pd.errors ?? [pd.message ?? pd.error ?? "publish failed"]));
      }
      setPublishResult({ ok: errors.length === 0, errors });
      await loadPosts();
      if (!errors.length) setTab("posts");
    } catch (e) {
      setPublishResult({ ok: false, errors: [e instanceof Error ? e.message : "A/B publish failed"] });
    }
    setPublishing(false);
  }

  async function loadImpact(postId: string) {
    setImpact((p) => ({ ...p, [postId]: "loading" }));
    try {
      const res = await fetch(`/api/marketing/impact?postId=${postId}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setImpact((p) => ({ ...p, [postId]: d.impact as ImpactData }));
    } catch {
      setImpact((p) => ({ ...p, [postId]: "error" }));
    }
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
            {(["create", "advisor", "posts", "report"] as Tab[]).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={cn("rounded-md px-4 py-1.5 text-sm font-semibold", tab === k ? "bg-white shadow text-brand-700" : "text-slate-500 hover:text-slate-700")}
              >
                {k === "create" ? t("mktTabCreate") : k === "advisor" ? t("mktTabAdvisor") : k === "posts" ? t("mktTabPosts") : t("mktTabReport")}
              </button>
            ))}
          </div>
        }
      />

      {/* ============ CREATE ============ */}
      {tab === "create" && (
        <div className="space-y-6 max-w-6xl">
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
                {selBooks.length > 0 && (
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" checked={freeChapter} onChange={(e) => setFreeChapter(e.target.checked)} />
                    📖 {t("mktFreeChapter")}
                  </label>
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
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-slate-500">{t("mktPostLang")}:</span>
              {(["ar", "en"] as const).map((pl) => (
                <button key={pl} onClick={() => setPostLang(pl)}
                  className={cn("rounded-lg border px-3 py-1 text-xs font-semibold", postLang === pl ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500 hover:border-slate-300")}>
                  {pl === "ar" ? "عربي" : "English"}
                </button>
              ))}
            </div>
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
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="block text-xs font-semibold text-slate-500">WhatsApp</label>
                    <button className="text-xs text-brand-600 hover:underline"
                      onClick={() => navigator.clipboard?.writeText(postWa)}>{t("mktCopy")}</button>
                  </div>
                  <textarea className="input min-h-28" value={postWa} onChange={(e) => setPostWa(e.target.value)} />
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                    <span className="text-slate-400">{t("mktWaAudiences")}:</span>
                    <a className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 hover:bg-slate-200" href="/products">{t("mktAudSameBook")}</a>
                    <a className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 hover:bg-slate-200" href="/customers">{t("mktAudChampions")}</a>
                    <a className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 hover:bg-slate-200" href="/abandoned">{t("mktAudAbandoned")}</a>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-secondary" onClick={saveDraft} disabled={saving}>
                    {savedId ? t("mktSaved") : saving ? "..." : t("mktSaveDraft")}
                  </button>
                  <button className="btn-secondary" onClick={loadPack} disabled={packLoading}>
                    📅 {packLoading ? "..." : t("mktPack")}
                  </button>
                </div>
                {pack && (
                  <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                    <div className="text-sm font-bold text-slate-700">📅 {t("mktPackTitle")}</div>
                    {pack.map((d) => (
                      <details key={d.day} className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                        <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                          {t("mktDay")} {d.day} — {d.theme}
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-slate-600">{d.post_fb}</pre>
                        <div className="mt-2 flex gap-2">
                          <button className="text-xs text-brand-600 hover:underline"
                            onClick={() => { setPostFb(d.post_fb); setPostIg(d.post_ig); setSavedId(null); }}>
                            {t("mktPackUse")}
                          </button>
                          <button className="text-xs text-slate-500 hover:underline"
                            onClick={() => navigator.clipboard?.writeText(d.post_fb)}>{t("mktCopy")}</button>
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Marketing director's plan */}
          {plan && <DirectorPlan plan={plan} />}

          {/* 3 — assets */}
          {hasCopy && (
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2 font-bold text-brand-700"><ImageIcon size={18} />3. {t("mktAssetsTitle")}</div>
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-500">{t("mktStyle")}</div>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(STYLE_NAMES) as AssetStyle[]).map((s) => (
                    <button key={s} onClick={() => setStyle(s)}
                      className={cn("rounded-lg border px-3 py-1.5 text-xs font-semibold", style === s ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500")}>
                      {STYLE_NAMES[s][lang]}
                    </button>
                  ))}
                </div>
                <div className="text-xs font-semibold text-slate-500">{t("mktLayout")}</div>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(LAYOUT_NAMES) as AssetLayout[]).map((l) => (
                    <button key={l} onClick={() => setLayout(l)}
                      className={cn("rounded-lg border px-3 py-1.5 text-xs font-semibold", layout === l ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500")}>
                      {LAYOUT_NAMES[l][lang]}
                    </button>
                  ))}
                </div>
                {(layout === "promo" || layout === "modern" || layout === "elegant") && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">{t("mktBadge")}</label>
                    <input className="input !py-1.5 w-44" placeholder="بخصم 30%" value={badge} onChange={(e) => setBadge(e.target.value)} />
                  </div>
                )}
                <div className="border-t border-slate-100 pt-3">
                  <div className="mb-1.5 text-xs font-semibold text-slate-500">🎨 {t("mktCustomUpload")}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="btn-secondary !py-1.5 text-xs" onClick={() => customRef.current?.click()}>
                      <UploadCloud size={14} />{t("mktCustomPick")}
                    </button>
                    <input ref={customRef} type="file" accept="image/*" multiple className="hidden"
                      onChange={(e) => { if (e.target.files?.length) pickCustomFiles(e.target.files); e.target.value = ""; }} />
                    {(Object.keys(custom) as AssetFmt[]).map((f) => (
                      <span key={f} className="inline-flex items-center gap-1 rounded-full bg-violet-50 border border-violet-200 px-2.5 py-1 text-xs text-violet-700">
                        {ASSET_LABELS[f][lang]}: {custom[f]!.name.slice(0, 18)}
                        <button onClick={() => { const n = { ...custom }; delete n[f]; setCustom(n); setPreviews({}); }}>
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">{t("mktCustomHint")}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4">
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
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" onClick={publishNow} disabled={publishing || !channels.length}>
                  <Send size={16} />
                  {publishing ? t("mktPublishing") : t("mktPublishNow")}
                </button>
                <button className="btn-secondary" onClick={abPublish} disabled={publishing || !channels.length}
                  title={t("mktAbHint")}>
                  <SplitSquareHorizontal size={16} />
                  {t("mktAbPublish")}
                </button>
              </div>
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

      {/* ============ ADVISOR ============ */}
      {tab === "advisor" && (
        advisorLoading || !advisor ? <Spinner /> : (
          <div className="space-y-6">
            {/* Occasions */}
            {advisor.occasions.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-bold text-slate-700">🗓️ {t("mktOccasions")}</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {advisor.occasions.map((o) => (
                    <div key={o.key} className={cn("rounded-xl border p-4",
                      o.inPrepWindow ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white")}>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm">{o.name}</span>
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold",
                          o.inPrepWindow ? "bg-amber-200 text-amber-800" : "bg-slate-100 text-slate-500")}>
                          {o.daysLeft <= 0 ? t("mktNow") : `${o.daysLeft} ${t("mktDaysLeft")}`}{o.approximate ? " ≈" : ""}
                        </span>
                      </div>
                      {o.inPrepWindow && <div className="mt-1 text-xs font-bold text-amber-700">⏰ {t("mktStartNow")}</div>}
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{o.advice}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Best posting hours */}
            {advisor.hours.length > 0 && (
              <div className="card p-5">
                <h3 className="mb-3 font-bold text-slate-700">⏰ {t("mktBestHours")}</h3>
                <div className="flex items-end gap-1" style={{ height: 90 }}>
                  {advisor.hours.map((x) => {
                    const max = Math.max(...advisor.hours.map((y) => y.orders), 1);
                    return (
                      <div key={x.h} className="flex flex-1 flex-col items-center gap-1" title={`${x.h}:00 — ${x.orders}`}>
                        <div className="w-full rounded-t bg-brand-400" style={{ height: `${Math.max((x.orders / max) * 70, 2)}px` }} />
                        <span className="text-[9px] text-slate-400">{x.h}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-slate-500">{t("mktBestHoursHint")}</p>
              </div>
            )}

            {/* What to promote next */}
            <div className="card overflow-x-auto">
              <div className="p-4 pb-0 font-bold text-slate-700">🎯 {t("mktPromoteNext")}</div>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{t("mktBook")}</th>
                    <th>{t("mktUnits30")}</th>
                    <th>{t("mktTrend")}</th>
                    <th>{t("mktStock")}</th>
                    <th>{t("mktWhy")}</th>
                  </tr>
                </thead>
                <tbody>
                  {advisor.picks.map((p) => (
                    <tr key={p.sku}>
                      <td className="!whitespace-normal max-w-[220px]">
                        <div className="font-medium">{p.product_name}</div>
                        <div className="text-[10px] text-slate-400" dir="ltr">{p.sku}</div>
                      </td>
                      <td className="font-semibold">{formatNumber(p.units_30)}</td>
                      <td className={cn("font-bold", (p.trend_pct ?? 0) >= 30 ? "text-emerald-600" : (p.trend_pct ?? 0) < 0 ? "text-red-500" : "text-slate-500")}>
                        {p.trend_pct != null ? `${p.trend_pct > 0 ? "+" : ""}${p.trend_pct}%` : "—"}
                      </td>
                      <td>{formatNumber(p.ecom_stock)}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {p.tags.map((tg) => (
                            <span key={tg} className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold",
                              tg === "rising" ? "bg-emerald-100 text-emerald-700"
                              : tg === "overstock" ? "bg-amber-100 text-amber-700"
                              : tg === "margin" ? "bg-brand-100 text-brand-700"
                              : "bg-slate-100 text-slate-600")}>
                              {tg === "rising" ? t("mktTagRising") : tg === "overstock" ? t("mktTagOverstock") : tg === "margin" ? t("mktTagMargin") : t("mktTagBestseller")}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="p-4 text-xs text-slate-400">{t("mktPromoteHint")}</p>
            </div>
          </div>
        )
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
                        {p.ab_group && (
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">A/B</span>
                        )}
                        {abWinners.has(p.id) && (
                          <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-bold text-yellow-700">🏆 {t("mktWinner")}</span>
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
                      {p.status === "published" && (
                        impact[p.id] && impact[p.id] !== "loading" && impact[p.id] !== "error" ? (
                          (() => {
                            const im = impact[p.id] as ImpactData;
                            const diff = im.before_units > 0
                              ? Math.round(((im.after_units - im.before_units) / im.before_units) * 100)
                              : im.after_units > 0 ? 100 : 0;
                            return (
                              <div>
                                <div className="font-bold text-slate-400">{t("mktImpact")}</div>
                                <div>
                                  {t("mktImpactBefore")}: {formatNumber(im.before_units)} · {t("mktImpactAfter")}: {formatNumber(im.after_units)}
                                  <span className={cn("ms-1 font-bold", diff > 0 ? "text-emerald-600" : diff < 0 ? "text-red-500" : "text-slate-400")}>
                                    ({diff > 0 ? "+" : ""}{diff}%)
                                  </span>
                                  · {formatMoney(im.after_revenue, lang)}
                                </div>
                              </div>
                            );
                          })()
                        ) : (
                          <button className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:border-brand-400 hover:text-brand-700"
                            onClick={() => loadImpact(p.id)} disabled={impact[p.id] === "loading"}>
                            📊 {impact[p.id] === "loading" ? "..." : impact[p.id] === "error" ? t("mktImpactError") : t("mktImpactBtn")}
                          </button>
                        )
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
// per-platform media-buyer configurations with manual setup walkthroughs,
// retargeting stack, A/B tests, SEO checklist and keyword plan.
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
      <div className="grid grid-cols-1 gap-1 md:grid-cols-[190px_1fr] md:gap-3">
        <div className="text-base font-bold text-slate-500">{label}</div>
        <div className="text-lg leading-relaxed text-slate-700 whitespace-pre-wrap">{value}</div>
      </div>
    ) : null;

  const kwBucket = (label: string, list: string[] | undefined, tone: string) =>
    list?.length ? (
      <div className="rounded-lg border border-slate-200 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-base font-bold text-slate-700">{label}</span>
          <button className="text-sm text-brand-600 hover:underline"
            onClick={() => navigator.clipboard?.writeText(list.join("\n"))}>
            {t("mktCopyList")}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {list.map((k, i) => (
            <span key={i} className={cn("rounded-full px-3 py-1 text-base", tone)} dir="auto">{k}</span>
          ))}
        </div>
      </div>
    ) : null;

  return (
    <div className="card p-5 space-y-5">
      <div className="flex items-center gap-2 text-lg font-bold text-brand-700">
        <Target size={20} />
        {t("mktPlanTitle")}
      </div>

      {/* Decision */}
      <div className={cn("rounded-lg border px-4 py-3", modeStyle)}>
        <div className="mb-1 text-lg font-bold">{modeLabel}</div>
        <div className="text-base leading-relaxed">{plan.decision?.reason}</div>
      </div>

      {/* Occasion */}
      {plan.occasion && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-base leading-relaxed text-violet-800">
          🗓️ <b>{t("mktOccasionNear")}:</b> {plan.occasion}
        </div>
      )}

      {/* Persona */}
      {plan.persona && (
        <div className="rounded-lg border border-slate-200 p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-lg font-bold text-slate-700">
            <Users size={18} />
            {t("mktPersonaTitle")}: {plan.persona.name}
          </div>
          <div className="flex flex-wrap gap-1.5 text-base">
            {plan.persona.age && <span className="rounded-full bg-slate-100 px-3 py-0.5">{t("mktAge")}: {plan.persona.age}</span>}
            {plan.persona.gender && <span className="rounded-full bg-slate-100 px-3 py-0.5">{plan.persona.gender}</span>}
          </div>
          <p className="text-base leading-relaxed text-slate-600">{plan.persona.description}</p>
          <div className="grid gap-4 md:grid-cols-2 text-base">
            {plan.persona.pains?.length > 0 && (
              <div>
                <div className="mb-1 font-bold text-red-600">{t("mktPains")}</div>
                <ul className="space-y-1 text-slate-600">{plan.persona.pains.map((x, i) => <li key={i}>• {x}</li>)}</ul>
              </div>
            )}
            {plan.persona.motivations?.length > 0 && (
              <div>
                <div className="mb-1 font-bold text-emerald-600">{t("mktMotivations")}</div>
                <ul className="space-y-1 text-slate-600">{plan.persona.motivations.map((x, i) => <li key={i}>• {x}</li>)}</ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Platform configs — the manual setup guide */}
      <div className="space-y-2">
        {(plan.platforms ?? []).map((p: AdConfig, i: number) => (
          <div key={i} className="rounded-lg border border-slate-200">
            <button className="flex w-full items-center justify-between px-4 py-3 text-lg font-bold text-slate-700"
              onClick={() => setOpen(open === i ? -1 : i)}>
              <span className="flex items-center gap-2"><Megaphone size={17} className="text-brand-500" />{p.platform}</span>
              <span className="text-slate-400">{open === i ? "−" : "+"}</span>
            </button>
            {open === i && (
              <div className="space-y-3 border-t border-slate-100 px-4 py-4">
                {row(t("mktObjective"), p.objective)}
                {row(t("mktAge"), p.age)}
                {row(t("mktGender"), p.gender)}
                {row(t("mktGeo"), p.geo)}
                {p.interests?.length > 0 && (
                  <div className="grid grid-cols-1 gap-1 md:grid-cols-[190px_1fr] md:gap-3">
                    <div className="text-base font-bold text-slate-500">{t("mktInterests")}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {p.interests.map((x, j) => <span key={j} className="rounded-full bg-brand-50 px-3 py-1 text-base text-brand-700" dir="auto">{x}</span>)}
                    </div>
                  </div>
                )}
                {row(t("mktPlacements"), p.placements)}
                {row(t("mktBudget"), p.budget)}
                {row(t("mktDuration"), p.duration)}
                {row(t("mktCreative"), p.creative)}
                {row(t("mktCta"), p.cta)}
                {row(t("mktSchedule"), p.schedule)}
                {p.steps && p.steps.length > 0 && (
                  <div className="rounded-lg bg-brand-50 border border-brand-100 px-4 py-3">
                    <div className="mb-2 flex items-center gap-1.5 text-base font-bold text-brand-800">
                      🧭 {t("mktSetupGuide")}
                    </div>
                    <ol className="space-y-2 text-base leading-relaxed text-brand-900">
                      {p.steps.map((s, j) => (
                        <li key={j} className="flex gap-2.5">
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{j + 1}</span>
                          <span>{s.replace(/^\d+[.)]\s*/, "")}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {p.tips?.length > 0 && (
                  <div className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-3 text-base text-amber-800">
                    <div className="mb-1.5 flex items-center gap-1.5 font-bold"><Lightbulb size={15} />{t("mktTips")}</div>
                    <ul className="space-y-1.5 leading-relaxed">{p.tips.map((x, j) => <li key={j}>• {x}</li>)}</ul>
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
          <div className="rounded-lg border border-slate-200 p-4 text-base">
            <div className="mb-2 flex items-center gap-1.5 font-bold text-slate-700"><Repeat size={16} />{t("mktRetargetingTitle")}</div>
            <ul className="space-y-1.5 leading-relaxed text-slate-600">{plan.retargeting.map((x, i) => <li key={i}>• {x}</li>)}</ul>
          </div>
        )}
        {plan.abTests?.length > 0 && (
          <div className="rounded-lg border border-slate-200 p-4 text-base">
            <div className="mb-2 flex items-center gap-1.5 font-bold text-slate-700"><SplitSquareHorizontal size={16} />{t("mktAbTitle")}</div>
            <ul className="space-y-1.5 leading-relaxed text-slate-600">{plan.abTests.map((x, i) => <li key={i}>• {x}</li>)}</ul>
          </div>
        )}
      </div>

      {/* SEO checklist */}
      {plan.seo && plan.seo.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
          <div className="mb-2 flex items-center gap-1.5 text-lg font-bold text-emerald-800">
            <Search size={17} />{t("mktSeoTitle")}
          </div>
          <ul className="space-y-2 text-base leading-relaxed text-slate-700">
            {plan.seo.map((x, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1 text-emerald-500">✔</span>
                <span>{x}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Keyword plan */}
      {plan.keywords && (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-lg font-bold text-slate-700">
            🔑 {t("mktKeywordsTitle")}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {kwBucket(t("mktKwTrans"), plan.keywords.transactional, "bg-emerald-100 text-emerald-800")}
            {kwBucket(t("mktKwInfo"), plan.keywords.informational, "bg-sky-100 text-sky-800")}
            {kwBucket(t("mktKwNeg"), plan.keywords.negatives, "bg-red-100 text-red-700")}
            {plan.keywords.research?.length ? (
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="mb-2 text-base font-bold text-slate-700">{t("mktKwResearch")}</div>
                <ol className="space-y-1.5 text-base leading-relaxed text-slate-600">
                  {plan.keywords.research.map((x, i) => <li key={i}>{i + 1}. {x}</li>)}
                </ol>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Multi-book idea */}
      {plan.multiBook && (
        <div className="rounded-lg bg-brand-50 border border-brand-100 px-4 py-3 text-base leading-relaxed text-brand-800">
          <b>📚 {t("mktMultiBookTitle")}:</b> {plan.multiBook}
        </div>
      )}
    </div>
  );
}
