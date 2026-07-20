"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Maximize2, Copy, Eye, ExternalLink, Link2, Trash2, RefreshCw, BookOpen, QrCode, Download, Search, Pencil, X, Check, Settings2, ArrowUpCircle, EyeOff, TrendingUp } from "lucide-react";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader } from "@/components/ui";

interface HostedBook {
  id: string;
  title: string;
  fmt?: string;
  size: number;
  pages?: number;
  createdAt: string;
  readerUrl: string;
  views: number;
  views7d: number;
  views30d?: number;
  category?: string | null;
  buyUrl?: string | null;
  isPublic?: boolean;
}

// Cache-buster for the embedded converter — bump when book-studio.html
// changes so nobody generates books with a stale cached build.
const STUDIO_V = "2026-07-20-layout-engine";

function fmtSize(bytes: number) {
  if (!bytes) return "—";
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ---- legacy → v2 upgrade helpers (client-side re-encode, same URL) ----

const CAN_WEBP = (() => {
  try {
    return typeof document !== "undefined" &&
      document.createElement("canvas").toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
})();

async function srcToCanvas(src: string): Promise<HTMLCanvasElement> {
  const img = new Image();
  if (!src.startsWith("data:")) img.crossOrigin = "anonymous"; // v2 pages live on the storage CDN
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("could not decode a page image"));
    img.src = src;
  });
  const c = document.createElement("canvas");
  c.width = Math.max(1, img.naturalWidth);
  c.height = Math.max(1, img.naturalHeight);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0);
  return c;
}

// Paginate an endless-scroll page (a reflowable chapter hosted before smart
// pagination existed) into 3:4-ish book pages, cutting on the emptiest pixel
// row near each boundary so text lines aren't sawn in half.
function sliceStrips(canvas: HTMLCanvasElement): HTMLCanvasElement[] {
  const pageH = Math.round(canvas.width * 1.33);
  let ink: number[] | null = null;
  let ratio = 1;
  try {
    const SW = 160;
    ratio = canvas.width / SW;
    const sc = document.createElement("canvas");
    sc.width = SW;
    sc.height = Math.max(1, Math.round(canvas.height / ratio));
    const x = sc.getContext("2d")!;
    x.drawImage(canvas, 0, 0, sc.width, sc.height);
    const d = x.getImageData(0, 0, sc.width, sc.height).data;
    ink = new Array(sc.height).fill(0);
    for (let y = 0; y < sc.height; y++) {
      let n = 0;
      for (let i = y * SW * 4; i < (y + 1) * SW * 4; i += 4) {
        if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) n++;
      }
      ink[y] = n;
    }
  } catch {
    ink = null;
  }
  const parts: HTMLCanvasElement[] = [];
  let sy = 0;
  let guard = 0;
  while (sy < canvas.height - 40 && guard++ < 80) {
    let cut = Math.min(canvas.height, sy + pageH);
    if (ink && cut < canvas.height) {
      let best = cut;
      let bestInk = Infinity;
      for (let y = sy + Math.round(pageH * 0.6); y <= cut; y++) {
        const iy = Math.min(ink.length - 1, Math.round(y / ratio));
        if (ink[iy] < bestInk) {
          bestInk = ink[iy];
          best = y;
        }
      }
      cut = best;
    }
    if (cut - sy < 40) cut = Math.min(canvas.height, sy + pageH);
    const c = document.createElement("canvas");
    c.width = canvas.width;
    c.height = cut - sy;
    c.getContext("2d")!.drawImage(canvas, 0, sy, canvas.width, cut - sy, 0, 0, canvas.width, cut - sy);
    parts.push(c);
    sy = cut;
  }
  return parts.length ? parts : [canvas];
}

// Fit every page into one per-book page box (median aspect) so the viewer
// never jumps between page sizes. Returns changed=false when the book is
// already uniform.
function boxAll(list: HTMLCanvasElement[]): { list: HTMLCanvasElement[]; changed: boolean } {
  if (list.length === 0) return { list, changed: false };
  if (list.every((c) => c.width === list[0].width && c.height === list[0].height)) {
    return { list, changed: false };
  }
  const aspects = list.map((c) => c.width / Math.max(1, c.height)).sort((a, b) => a - b);
  const asp = Math.min(1.6, Math.max(0.5, aspects[aspects.length >> 1] || 0.75));
  const boxW = Math.min(2000, Math.max(...list.map((c) => c.width)));
  const boxH = Math.max(1, Math.round(boxW / asp));
  return {
    changed: true,
    list: list.map((src) => {
      if (src.width === boxW && src.height === boxH) return src;
      const c = document.createElement("canvas");
      c.width = boxW;
      c.height = boxH;
      const x = c.getContext("2d")!;
      x.fillStyle = "#ffffff";
      x.fillRect(0, 0, boxW, boxH);
      const s = Math.min(boxW / src.width, boxH / src.height, 1);
      const dw = Math.max(1, Math.round(src.width * s));
      const dh = Math.max(1, Math.round(src.height * s));
      x.imageSmoothingQuality = "high";
      x.drawImage(src, Math.round((boxW - dw) / 2), Math.round((boxH - dh) / 2), dw, dh);
      return c;
    }),
  };
}

function canvasBlob(c: HTMLCanvasElement, mime: string, q: number): Promise<Blob | null> {
  return new Promise((r) => c.toBlob(r, mime, q));
}

// Batch-sign storage paths through the API and PUT the blobs to them.
async function signAndUpload(
  id: string,
  files: { name: string; blob: Blob }[],
  mime: string,
  onStep?: (done: number, total: number) => void
) {
  let done = 0;
  for (let i = 0; i < files.length; i += 20) {
    const chunk = files.slice(i, i + 20);
    const sres = await fetch("/api/flipbooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sign: id, files: chunk.map((f) => f.name) }),
    });
    if (!sres.ok) throw new Error(`sign failed (HTTP ${sres.status})`);
    const { urls } = await sres.json();
    await Promise.all(
      chunk.map(async (f, j) => {
        const up = await fetch(urls[j], {
          method: "PUT",
          // upsert: a retried upgrade may overwrite its own partial upload
          headers: { "content-type": f.name === "manifest" ? "application/json" : mime, "x-upsert": "true" },
          body: f.blob,
        });
        if (!up.ok) throw new Error(`upload failed on ${f.name} (HTTP ${up.status})`);
        done++;
        onStep?.(done, files.length);
      })
    );
  }
}

// Tiny dependency-free bar chart for the last-30-days views.
function ViewsChart({ days, noDataText }: { days: { day: string; views: number }[]; noDataText: string }) {
  const max = Math.max(...days.map((d) => d.views), 1);
  const total = days.reduce((s, d) => s + d.views, 0);
  if (total === 0) return <p className="py-3 text-center text-xs text-slate-400">{noDataText}</p>;
  return (
    <div className="flex h-16 items-end gap-[2px]" dir="ltr">
      {days.map((d) => (
        <div
          key={d.day}
          className="flex-1 rounded-t bg-brand-400/70 hover:bg-brand-500 transition-colors min-w-[3px]"
          style={{ height: `${Math.max(d.views > 0 ? 8 : 2, Math.round((d.views / max) * 100))}%` }}
          title={`${d.day} — ${d.views}`}
        />
      ))}
    </div>
  );
}

export default function StudioPage() {
  const { t, lang } = useLang();
  const [url, setUrl] = useState("");
  const [w, setW] = useState("100%");
  const [h, setH] = useState("400");
  const [copied, setCopied] = useState(false);
  const [books, setBooks] = useState<HostedBook[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [totalViews, setTotalViews] = useState(0);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [copiedId, setCopiedId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [qrId, setQrId] = useState("");
  const [qrData, setQrData] = useState("");
  const [query, setQuery] = useState("");
  const [renameId, setRenameId] = useState("");
  const [renameVal, setRenameVal] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [detailsId, setDetailsId] = useState("");
  const [detCategory, setDetCategory] = useState("");
  const [detBuy, setDetBuy] = useState("");
  const [detPublic, setDetPublic] = useState(true);
  const [detSaving, setDetSaving] = useState(false);
  const [detSaved, setDetSaved] = useState(false);
  const [detError, setDetError] = useState("");
  const [chartDays, setChartDays] = useState<{ day: string; views: number }[]>([]);
  const [upgradingId, setUpgradingId] = useState("");
  const [upgradeErrId, setUpgradeErrId] = useState("");
  const [upgradeMsg, setUpgradeMsg] = useState("");
  const supabase = useMemo(() => createClient(), []);

  const loadBooks = useCallback(async () => {
    try {
      const res = await fetch("/api/flipbooks");
      if (!res.ok) return;
      const j = await res.json();
      setBooks(j.books || []);
      setTotalBytes(j.totalBytes || 0);
      setTotalViews(j.totalViews || 0);
    } catch {
      // list stays as-is; the refresh button retries
    } finally {
      setLoadingBooks(false);
    }
  }, []);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  // When the converter hosts a flipbook it posts the reader URL up to us:
  // the embed generator fills itself in and the hosted list refreshes.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "flipbook-hosted" && typeof e.data.url === "string") {
        if (!e.data.silent) setUrl(e.data.url);
        loadBooks();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loadBooks]);

  const embed = url
    ? `<iframe src="${url}" width="${w}" height="${h}" style="border:0;border-radius:12px;max-width:100%" allowfullscreen loading="lazy" title="Nahdet Misr Book"></iframe>`
    : "";

  function copy() {
    navigator.clipboard.writeText(embed);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function embedFor(b: HostedBook) {
    const title = (b.title || "Book").replace(/"/g, "&quot;");
    return `<iframe src="${b.readerUrl}" width="${w}" height="${h}" style="border:0;border-radius:12px;max-width:100%" allowfullscreen loading="lazy" title="${title}"></iframe>`;
  }

  function copyText(key: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(key);
    setTimeout(() => setCopiedId(""), 1500);
  }

  async function toggleQr(b: HostedBook) {
    if (qrId === b.id) {
      setQrId("");
      return;
    }
    // High error correction + wide margin = reliable scans even on small prints.
    const dataUrl = await QRCode.toDataURL(b.readerUrl, {
      width: 1024,
      margin: 4,
      errorCorrectionLevel: "H",
    });
    setQrData(dataUrl);
    setQrId(b.id);
  }

  function startRename(b: HostedBook) {
    setRenameId(b.id);
    setRenameVal(b.title || "");
  }

  async function saveRename() {
    const id = renameId;
    const title = renameVal.trim();
    if (!id || !title) return;
    setRenaming(true);
    try {
      const res = await fetch("/api/flipbooks", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, title }),
      });
      if (res.ok) {
        setBooks((prev) => prev.map((x) => (x.id === id ? { ...x, title } : x)));
        setRenameId("");
      }
    } finally {
      setRenaming(false);
    }
  }

  async function toggleDetails(b: HostedBook) {
    if (detailsId === b.id) {
      setDetailsId("");
      return;
    }
    setDetailsId(b.id);
    setDetCategory(b.category || "");
    setDetBuy(b.buyUrl || "");
    setDetPublic(b.isPublic !== false);
    setDetSaved(false);
    setDetError("");
    // last-30-days daily views for the chart (beacon counts under {id}.html)
    setChartDays([]);
    const from = new Date(Date.now() - 29 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const { data } = await supabase
      .from("flipbook_views")
      .select("day, views")
      .eq("path", `${b.id}.html`)
      .gte("day", from)
      .order("day");
    const byDay = new Map((data || []).map((r) => [r.day as string, Number(r.views) || 0]));
    const days: { day: string; views: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
      days.push({ day: d, views: byDay.get(d) || 0 });
    }
    setChartDays(days);
  }

  async function saveDetails(b: HostedBook) {
    setDetSaving(true);
    setDetError("");
    try {
      const res = await fetch("/api/flipbooks", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: b.id, category: detCategory, buyUrl: detBuy, isPublic: detPublic }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setDetError(j?.error || `HTTP ${res.status}`);
        return;
      }
      setBooks((prev) =>
        prev.map((x) =>
          x.id === b.id
            ? { ...x, category: detCategory.trim() || null, buyUrl: detBuy.trim() || null, isPublic: detPublic }
            : x
        )
      );
      setDetSaved(true);
      setTimeout(() => setDetSaved(false), 1800);
    } finally {
      setDetSaving(false);
    }
  }

  // Check & repair a hosted book at the SAME id (embeds/QRs survive):
  // loads its pages, paginates endless-scroll chapters, unifies page sizes,
  // and (for legacy single-file books) converts to the light v2 format. A v2
  // book whose pages are already healthy is left completely untouched.
  const upgradeBook = useCallback(
    async (b: HostedBook, silent = false) => {
      if (!silent && !window.confirm(t("upgradeConfirm"))) return false;
      setUpgradingId(b.id);
      setUpgradeErrId("");
      setUpgradeMsg(t("upgrading"));
      try {
        const res = await fetch(`/reader/${b.id}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`could not load the book (HTTP ${res.status})`);
        const html = await res.text();
        const marker = "var PAGES = ";
        const start = html.indexOf(marker);
        const end = start >= 0 ? html.indexOf("];", start) : -1;
        if (start < 0 || end < 0) throw new Error("book pages not found");
        const srcs: string[] = JSON.parse(html.slice(start + marker.length, end + 1));
        if (!Array.isArray(srcs) || srcs.length === 0) throw new Error("no pages in this book");
        const rtl = /var RTL\s*=\s*true/.test(html);

        // load + geometry repair: slice endless strips, then unify page sizes
        let canvases: HTMLCanvasElement[] = [];
        for (let i = 0; i < srcs.length; i++) {
          setUpgradeMsg(`${t("upgrading")} ${i + 1}/${srcs.length}`);
          const c = await srcToCanvas(srcs[i]);
          if (c.height > c.width * 2.2) canvases.push(...sliceStrips(c));
          else canvases.push(c);
        }
        const sliced = canvases.length !== srcs.length;
        const boxed = boxAll(canvases);
        if (b.fmt === "v2" && !sliced && !boxed.changed) {
          setUpgradeErrId(b.id);
          setUpgradeMsg(t("repairHealthy"));
          setTimeout(() => {
            setUpgradeErrId("");
            setUpgradeMsg("");
          }, 4000);
          return false; // healthy — nothing uploaded, no reload needed
        }
        canvases = boxed.list;

        const mime = CAN_WEBP ? "image/webp" : "image/jpeg";
        const ext = CAN_WEBP ? "webp" : "jpg";
        const q = CAN_WEBP ? 0.85 : 0.9;
        const files: { name: string; blob: Blob }[] = [];
        let coverBlob: Blob | null = null;
        for (let i = 0; i < canvases.length; i++) {
          setUpgradeMsg(`${t("upgrading")} ${i + 1}/${canvases.length}`);
          const c = canvases[i];
          const blob = (await canvasBlob(c, mime, q)) || (await canvasBlob(c, "image/jpeg", 0.85));
          if (!blob) throw new Error(`could not encode page ${i + 1}`);
          files.push({ name: `p${i + 1}.${ext}`, blob });
          if (i === 0) {
            const cw = Math.min(480, c.width);
            const cc = document.createElement("canvas");
            cc.width = cw;
            cc.height = Math.max(1, Math.round((c.height * cw) / c.width));
            const ccx = cc.getContext("2d")!;
            ccx.fillStyle = "#ffffff";
            ccx.fillRect(0, 0, cc.width, cc.height);
            ccx.drawImage(c, 0, 0, cc.width, cc.height);
            coverBlob = await canvasBlob(cc, mime, 0.72);
          }
        }
        if (coverBlob) files.push({ name: `cover.${ext}`, blob: coverBlob });
        const sizeBytes = files.reduce((s, f) => s + f.blob.size, 0);

        const create = await fetch("/api/flipbooks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            v: 2,
            id: b.id,
            migrate: true,
            filename: b.id,
            title: b.title || b.id,
            pages: canvases.length,
            ext,
            rtl,
            sizeBytes,
            cover: !!coverBlob,
          }),
        });
        if (!create.ok) throw new Error(`registration failed (HTTP ${create.status})`);

        await signAndUpload(b.id, files, mime, (done, total) =>
          setUpgradeMsg(`${t("upgrading")} ${done}/${total}`)
        );
        const manifest = {
          v: 2,
          title: b.title || b.id,
          rtl,
          ext,
          pages: canvases.length,
          bytes: sizeBytes,
          cover: coverBlob ? `cover.${ext}` : "",
          buyUrl: b.buyUrl || "",
        };
        await signAndUpload(
          b.id,
          [{ name: "manifest", blob: new Blob([JSON.stringify(manifest)], { type: "application/json" }) }],
          mime
        );
        // only a legacy single-file book has an old .html to park in trash
        if (b.fmt !== "v2") {
          const fin = await fetch("/api/flipbooks", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ finishMigrate: b.id }),
          });
          if (!fin.ok) throw new Error(`cleanup failed (HTTP ${fin.status})`);
        }
        setUpgradeMsg("");
        return true;
      } catch (e) {
        setUpgradeErrId(b.id);
        setUpgradeMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
        return false;
      } finally {
        setUpgradingId("");
      }
    },
    [t]
  );

  async function upgradeAllLegacy() {
    const legacy = books.filter((b) => b.fmt !== "v2");
    if (legacy.length === 0 || !window.confirm(t("upgradeAllConfirm"))) return;
    for (const b of legacy) {
      const ok = await upgradeBook(b, true);
      if (!ok) break; // the failed book keeps its error message on screen
    }
    await loadBooks();
  }

  async function deleteBook(b: HostedBook) {
    if (!window.confirm(t("deleteBookConfirm"))) return;
    setDeletingId(b.id);
    try {
      const res = await fetch("/api/flipbooks", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: b.id }),
      });
      if (res.ok) {
        setBooks((prev) => prev.filter((x) => x.id !== b.id));
        setTotalBytes((prev) => Math.max(0, prev - b.size));
      }
    } finally {
      setDeletingId("");
    }
  }

  const norm = query.trim().toLowerCase();
  const shown = norm
    ? books.filter((b) => (b.title || "").toLowerCase().includes(norm) || b.id.toLowerCase().includes(norm))
    : books;

  return (
    <div>
      <PageHeader
        title={t("studio")}
        subtitle={t("studioSubtitle")}
        actions={
          <a href={`/tools/book-studio.html?v=${STUDIO_V}`} target="_blank" rel="noopener noreferrer" className="btn-secondary">
            <Maximize2 size={16} />
            {t("openStudio")}
          </a>
        }
      />

      <div className="card overflow-hidden mb-6">
        <iframe src={`/tools/book-studio.html?v=${STUDIO_V}`} title="Book Studio" className="w-full" style={{ height: "78vh", border: 0 }} />
      </div>

      <div className="card p-5 mb-6">
        <h3 className="mb-1 font-bold">{t("embedTitle")}</h3>
        <p className="mb-4 text-xs text-slate-500">{t("embedHint")}</p>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold mb-1 text-slate-500">{t("bookUrlLabel")}</label>
            <input className="input" dir="ltr" placeholder="https://books.nahdetmisr.com/9789771459750/" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-500">{t("embedWidth")}</label>
            <input className="input" dir="ltr" value={w} onChange={(e) => setW(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-500">{t("embedHeight")}</label>
            <input className="input" dir="ltr" value={h} onChange={(e) => setH(e.target.value)} />
          </div>
        </div>
        {embed && (
          <div className="mt-4">
            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100" dir="ltr">
              {embed}
            </pre>
            <button className="btn-primary mt-2" onClick={copy}>
              <Copy size={15} />
              {copied ? t("copied") : t("copyEmbed")}
            </button>
          </div>
        )}
      </div>

      <div className="card p-5 mb-6">
        <div className="mb-1 flex items-center justify-between gap-3 flex-wrap">
          <h3 className="flex items-center gap-2 font-bold">
            <BookOpen size={18} className="text-brand-500" />
            {t("hostedBooks")}
            {books.length > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">{books.length}</span>
            )}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            {totalViews > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-600" title={t("viewsHint")}>
                <Eye size={13} />
                {totalViews.toLocaleString(lang === "ar" ? "ar-EG" : "en-GB")} {t("bookViews")}
              </span>
            )}
            {totalBytes > 0 && (
              <span className="text-xs text-slate-400">
                {t("storageUsed")}: {fmtSize(totalBytes)}
              </span>
            )}
            <a className="btn-secondary !px-2.5 !py-1.5 !text-xs" href="/library" target="_blank" rel="noopener noreferrer" title={t("publicLibraryHint")}>
              <BookOpen size={13} />
              {t("publicLibrary")}
            </a>
            <button
              className="btn-secondary !px-2.5 !py-1.5 !text-xs"
              onClick={() => copyText("library", `${window.location.origin}/library`)}
              title={t("publicLibraryHint")}
            >
              <Link2 size={13} />
              {copiedId === "library" ? t("copied") : t("copyLink")}
            </button>
            {books.filter((b) => b.fmt !== "v2").length > 1 && (
              <button
                className="btn-secondary !px-2.5 !py-1.5 !text-xs !text-emerald-700"
                onClick={upgradeAllLegacy}
                disabled={!!upgradingId}
                title={t("upgradeHint")}
              >
                <ArrowUpCircle size={13} />
                {t("upgradeAll")}
              </button>
            )}
            <button className="btn-secondary !px-2.5 !py-1.5" onClick={() => loadBooks()} title={t("refresh")}>
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
        <p className="mb-4 text-xs text-slate-500">{t("hostedHint")}</p>

        {books.some((b) => (b.views30d || 0) > 0) && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
            <span className="flex items-center gap-1 font-semibold text-slate-500">
              <TrendingUp size={13} className="text-brand-500" />
              {t("topBooks30")}:
            </span>
            {[...books]
              .sort((a, b) => (b.views30d || 0) - (a.views30d || 0))
              .slice(0, 3)
              .filter((b) => (b.views30d || 0) > 0)
              .map((b, i) => (
                <span key={b.id} className="rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 shadow-sm">
                  {i + 1}. {b.title || b.id}
                  <span className="ms-1 font-bold text-brand-600">
                    {(b.views30d || 0).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB")}
                  </span>
                </span>
              ))}
          </div>
        )}

        {books.length > 0 && (
          <div className="relative mb-4 max-w-md">
            <Search size={15} className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-slate-400 ltr:left-3 rtl:right-3" />
            <input
              className="input !ps-9"
              placeholder={t("searchBooksPh")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                className="absolute top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 ltr:right-3 rtl:left-3"
                onClick={() => setQuery("")}
                aria-label="clear"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {loadingBooks ? (
          <p className="py-4 text-center text-sm text-slate-400">…</p>
        ) : books.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">{t("hostedEmpty")}</p>
        ) : shown.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">{t("searchNoBooks")}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((b) => (
              <li key={b.id} className="py-2.5">
                <div className="flex items-center gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  {renameId === b.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        className="input !py-1.5 !text-sm max-w-sm"
                        value={renameVal}
                        autoFocus
                        onChange={(e) => setRenameVal(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveRename();
                          if (e.key === "Escape") setRenameId("");
                        }}
                      />
                      <button className="btn-primary !px-2.5 !py-1.5 !text-xs" onClick={saveRename} disabled={renaming || !renameVal.trim()}>
                        <Check size={13} />
                        {t("renameSave")}
                      </button>
                      <button className="btn-secondary !px-2.5 !py-1.5 !text-xs" onClick={() => setRenameId("")} disabled={renaming}>
                        {t("renameCancel")}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold">{b.title || b.id}</span>
                      {b.fmt === "v2" && (
                        <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600" title={t("lightFormatHint")}>
                          WebP
                        </span>
                      )}
                      {b.isPublic === false && (
                        <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500" title={t("hiddenLinkOnly")}>
                          <EyeOff size={10} />
                          {t("hiddenBadge")}
                        </span>
                      )}
                      {b.category && (
                        <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">
                          {b.category}
                        </span>
                      )}
                      <button
                        className="shrink-0 text-slate-300 hover:text-brand-500"
                        onClick={() => startRename(b)}
                        title={t("renameBook")}
                      >
                        <Pencil size={13} />
                      </button>
                    </div>
                  )}
                  <div className="text-xs text-slate-400" dir="ltr">
                    {b.createdAt ? new Date(b.createdAt).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { year: "numeric", month: "short", day: "numeric" }) : ""}
                    {" · "}
                    {fmtSize(b.size)}
                    {(b.pages || 0) > 0 && <> · {b.pages} {t("bookPages")}</>}
                  </div>
                  {(upgradingId === b.id || upgradeErrId === b.id) && upgradeMsg && (
                    <div className={`mt-0.5 text-xs font-medium ${upgradeMsg.startsWith("✗") ? "text-red-600" : "text-emerald-600"}`}>
                      {upgradeMsg}
                    </div>
                  )}
                  <div className="mt-0.5 flex items-center gap-1 text-xs font-medium text-brand-600" title={t("viewsHint")}>
                    <Eye size={12} />
                    <span>
                      {(b.views || 0).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB")} {t("bookViews")}
                      {b.views7d > 0 && <span className="text-slate-400"> · {b.views7d.toLocaleString(lang === "ar" ? "ar-EG" : "en-GB")} {t("views7d")}</span>}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button className="btn-secondary !px-2.5 !py-1.5 !text-xs" onClick={() => copyText(`${b.id}:embed`, embedFor(b))}>
                    <Copy size={13} />
                    {copiedId === `${b.id}:embed` ? t("copied") : t("copyEmbed")}
                  </button>
                  <button className="btn-secondary !px-2.5 !py-1.5 !text-xs" onClick={() => copyText(`${b.id}:link`, b.readerUrl)}>
                    <Link2 size={13} />
                    {copiedId === `${b.id}:link` ? t("copied") : t("copyLink")}
                  </button>
                  <button className="btn-secondary !px-2.5 !py-1.5 !text-xs" onClick={() => toggleQr(b)}>
                    <QrCode size={13} />
                    {t("qrCode")}
                  </button>
                  <button
                    className={`btn-secondary !px-2.5 !py-1.5 !text-xs ${detailsId === b.id ? "!bg-brand-50 !text-brand-600" : ""}`}
                    onClick={() => toggleDetails(b)}
                    title={t("bookDetails")}
                  >
                    <Settings2 size={13} />
                    {t("bookDetails")}
                  </button>
                  <button
                    className="btn-secondary !px-2.5 !py-1.5 !text-xs !text-emerald-700"
                    onClick={async () => {
                      if (await upgradeBook(b)) loadBooks();
                    }}
                    disabled={!!upgradingId}
                    title={t("upgradeHint")}
                  >
                    <ArrowUpCircle size={13} />
                    {t("upgradeBook")}
                  </button>
                  <a className="btn-secondary !px-2.5 !py-1.5 !text-xs" href={b.readerUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={13} />
                    {t("openLink")}
                  </a>
                  <button
                    className="btn-secondary !px-2.5 !py-1.5 !text-xs !text-red-600"
                    onClick={() => deleteBook(b)}
                    disabled={deletingId === b.id}
                  >
                    <Trash2 size={13} />
                    {t("deleteBook")}
                  </button>
                </div>
                </div>
                {detailsId === b.id && (
                  <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-500">{t("categoryLabel")}</label>
                        <input
                          className="input !py-1.5 !text-sm"
                          list="book-categories"
                          placeholder={t("categoryPh")}
                          value={detCategory}
                          onChange={(e) => setDetCategory(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-500">{t("buyLinkLabel")}</label>
                        <input
                          className="input !py-1.5 !text-sm"
                          dir="ltr"
                          placeholder="https://nahdetmisr.com/product/..."
                          value={detBuy}
                          onChange={(e) => setDetBuy(e.target.value)}
                        />
                      </div>
                    </div>
                    <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
                      <input type="checkbox" checked={detPublic} onChange={(e) => setDetPublic(e.target.checked)} />
                      <span>{detPublic ? t("visibleInLibrary") : t("hiddenLinkOnly")}</span>
                    </label>
                    <div className="mt-3 flex items-center gap-2">
                      <button className="btn-primary !px-3 !py-1.5 !text-xs" onClick={() => saveDetails(b)} disabled={detSaving}>
                        <Check size={13} />
                        {detSaved ? t("detailsSaved") : t("renameSave")}
                      </button>
                      {detError && <span className="text-xs text-red-600">✗ {detError}</span>}
                    </div>
                    <div className="mt-4">
                      <p className="mb-1.5 text-xs font-semibold text-slate-500">{t("viewsChart30")}</p>
                      {chartDays.length === 0 ? (
                        <p className="py-3 text-center text-xs text-slate-400">…</p>
                      ) : (
                        <ViewsChart days={chartDays} noDataText={t("noViewsYet")} />
                      )}
                    </div>
                  </div>
                )}
                {qrId === b.id && qrData && (
                  <div className="mt-3 flex items-center gap-4 rounded-xl border border-slate-100 bg-slate-50 p-3 flex-wrap">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrData} alt={`QR — ${b.title}`} className="h-36 w-36 rounded-lg border border-slate-200 bg-white" />
                    <div className="min-w-0 flex-1">
                      <p className="mb-2 text-xs text-slate-500">{t("qrHint")}</p>
                      <p className="mb-3 truncate text-xs text-slate-400" dir="ltr">{b.readerUrl}</p>
                      <a className="btn-primary !px-3 !py-1.5 !text-xs" href={qrData} download={`${b.id}-qr.png`}>
                        <Download size={13} />
                        {t("downloadPng")}
                      </a>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <datalist id="book-categories">
          {[...new Set(books.map((b) => b.category).filter(Boolean))].map((c) => (
            <option key={c as string} value={c as string} />
          ))}
        </datalist>
      </div>

    </div>
  );
}
