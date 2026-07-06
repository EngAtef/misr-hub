"use client";

import { useState } from "react";
import { Maximize2, Copy, Lightbulb } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { PageHeader } from "@/components/ui";

export default function StudioPage() {
  const { t } = useLang();
  const [url, setUrl] = useState("");
  const [w, setW] = useState("100%");
  const [h, setH] = useState("600");
  const [copied, setCopied] = useState(false);

  const embed = url
    ? `<iframe src="${url}" width="${w}" height="${h}" style="border:0;border-radius:12px;max-width:100%" allowfullscreen loading="lazy" title="Nahdet Misr Book"></iframe>`
    : "";

  function copy() {
    navigator.clipboard.writeText(embed);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
