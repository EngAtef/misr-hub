"use client";

import { useCallback, useEffect, useState } from "react";
import { Maximize2, Copy, Lightbulb, ExternalLink, Link2, Trash2, RefreshCw, BookOpen } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { PageHeader } from "@/components/ui";

interface HostedBook {
  id: string;
  title: string;
  size: number;
  createdAt: string;
  readerUrl: string;
}

function fmtSize(bytes: number) {
  if (!bytes) return "—";
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function StudioPage() {
  const { t, lang } = useLang();
  const [url, setUrl] = useState("");
  const [w, setW] = useState("100%");
  const [h, setH] = useState("600");
  const [copied, setCopied] = useState(false);
  const [books, setBooks] = useState<HostedBook[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [copiedId, setCopiedId] = useState("");
  const [deletingId, setDeletingId] = useState("");

  const loadBooks = useCallback(async () => {
    try {
      const res = await fetch("/api/flipbooks");
      if (!res.ok) return;
      const j = await res.json();
      setBooks(j.books || []);
      setTotalBytes(j.totalBytes || 0);
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

  return (
    <div>
      <PageHeader
        title={t("studio")}
        subtitle={t("studioSubtitle")}
        actions={
          <a href="/tools/book-studio.html" target="_blank" rel="noopener noreferrer" className="btn-secondary">
            <Maximize2 size={16} />
            {t("openStudio")}
          </a>
        }
      />

      <div className="card overflow-hidden mb-6">
        <iframe src="/tools/book-studio.html" title="Book Studio" className="w-full" style={{ height: "78vh", border: 0 }} />
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
          <div className="flex items-center gap-3">
            {totalBytes > 0 && (
              <span className="text-xs text-slate-400">
                {t("storageUsed")}: {fmtSize(totalBytes)}
              </span>
            )}
            <button className="btn-secondary !px-2.5 !py-1.5" onClick={() => loadBooks()} title={t("refresh")}>
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
        <p className="mb-4 text-xs text-slate-500">{t("hostedHint")}</p>

        {loadingBooks ? (
          <p className="py-4 text-center text-sm text-slate-400">…</p>
        ) : books.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">{t("hostedEmpty")}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {books.map((b) => (
              <li key={b.id} className="flex items-center gap-3 py-2.5 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{b.title || b.id}</div>
                  <div className="text-xs text-slate-400" dir="ltr">
                    {b.createdAt ? new Date(b.createdAt).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { year: "numeric", month: "short", day: "numeric" }) : ""}
                    {" · "}
                    {fmtSize(b.size)}
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
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card p-5">
        <h3 className="mb-3 flex items-center gap-2 font-bold">
          <Lightbulb size={18} className="text-gold" />
          {t("studioIdeas")}
        </h3>
        <ul className="space-y-2 text-sm text-slate-600">
          <li className="flex gap-2"><span className="text-brand-500">•</span>{t("studioIdea1")}</li>
          <li className="flex gap-2"><span className="text-brand-500">•</span>{t("studioIdea2")}</li>
          <li className="flex gap-2"><span className="text-brand-500">•</span>{t("studioIdea3")}</li>
        </ul>
      </div>
    </div>
  );
}
