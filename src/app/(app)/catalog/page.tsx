"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UploadCloud, Download, BookOpen, CheckCircle2, Warehouse } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { PageHeader, Spinner } from "@/components/ui";
import { formatNumber, toCsv, downloadCsv, cn } from "@/lib/utils";
import { parseCatalogFile, CATALOG_FIELDS, type CatalogBook, type CatalogField } from "@/lib/import/parse-catalog";

// Arabic-aware title normalization for SAP <-> website matching
function normTitle(s: string): string {
  return s
    .replace(/[ً-ْـ]/g, "") // diacritics + tatweel
    .replace(/[أإآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ىي]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

const FIELD_LABEL: Record<CatalogField, DictKey> = {
  name: "fldName",
  english_name: "fldEnglishName",
  price: "fldPrice",
  stock: "fldStock",
  section: "fldSection",
  category: "fldCategory",
  language: "fldLanguage",
  age: "fldAge",
  series: "fldSeries",
  publisher: "fldPublisher",
  author: "fldAuthor",
  link: "fldLink",
  release_date: "fldReleaseDate",
};

function SapVsWebsite({ catalogBooks }: { catalogBooks: CatalogBook[] | null }) {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [sapRows, setSapRows] = useState<{ sku: string; product_name: string | null; sap_stock: number | null }[] | null>(null);
  const [siteNames, setSiteNames] = useState<Set<string> | null>(null);

  useEffect(() => {
    (async () => {
      // all SAP materials stored via the Data Center SAP upload
      const all: { sku: string; product_name: string | null; sap_stock: number | null }[] = [];
      for (let offset = 0; offset < 60000; offset += 1000) {
        const { data } = await supabase
          .from("stock_items")
          .select("sku, product_name, sap_stock")
          .not("sap_stock", "is", null)
          .range(offset, offset + 999);
        const chunk = (data as typeof all) ?? [];
        all.push(...chunk);
        if (chunk.length < 1000) break;
      }
      setSapRows(all);
      // every title ever sold on the website
      const { data: sold } = await supabase.rpc("fn_top_products", { p_from: null, p_to: null, p_limit: 20000 });
      const names = new Set<string>();
      for (const p of (sold as { product_name: string }[]) ?? []) names.add(normTitle(p.product_name));
      setSiteNames(names);
    })();
  }, [supabase]);

  const result = useMemo(() => {
    if (!sapRows || !siteNames) return null;
    const known = new Set(siteNames);
    if (catalogBooks) {
      for (const b of catalogBooks) {
        if (b.name) known.add(normTitle(b.name));
        if (b.english_name) known.add(normTitle(b.english_name));
      }
    }
    const missing = sapRows.filter((r) => {
      if (!r.product_name) return true;
      return !known.has(normTitle(r.product_name));
    });
    return { total: sapRows.length, missing, matched: sapRows.length - missing.length };
  }, [sapRows, siteNames, catalogBooks]);

  if (sapRows !== null && sapRows.length === 0) {
    return (
      <div className="card p-5 mb-6 flex items-center gap-3 text-sm text-slate-500">
        <Warehouse size={18} className="text-slate-400" />
        {t("sapNoData")}
      </div>
    );
  }

  return (
    <div className="card p-5 mb-6">
      <div className="mb-1 flex items-center gap-2">
        <Warehouse size={18} className="text-brand-600" />
        <h3 className="text-sm font-bold text-slate-700">{t("sapMissingTitle")}</h3>
      </div>
      <p className="mb-4 text-xs text-slate-500">{t("sapMissingHint")}</p>
      {!result ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <div className="text-xl font-bold">{formatNumber(result.total)}</div>
              <div className="text-[11px] text-slate-500">{t("sapTotal")}</div>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3 text-center">
              <div className="text-xl font-bold text-emerald-700">{formatNumber(result.matched)}</div>
              <div className="text-[11px] text-slate-500">{t("sapMatched")}</div>
            </div>
            <div className="rounded-xl bg-red-50 p-3 text-center">
              <div className="text-xl font-bold text-red-700">{formatNumber(result.missing.length)}</div>
              <div className="text-[11px] text-slate-500">{t("sapMissing")}</div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">{formatNumber(Math.min(result.missing.length, 200))} / {formatNumber(result.missing.length)}</span>
            <button
              className="btn-secondary !py-1.5 text-xs"
              onClick={() =>
                downloadCsv(
                  `sap-missing-on-website-${new Date().toISOString().slice(0, 10)}.csv`,
                  toCsv(result.missing.map((r) => ({ SKU: r.sku, Title: r.product_name ?? "", "SAP Qty": r.sap_stock ?? 0 })))
                )
              }
            >
              <Download size={14} />
              {t("exportCsv")}
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t("sku")}</th>
                  <th>{t("fldName")}</th>
                  <th>{t("sapQty")}</th>
                </tr>
              </thead>
              <tbody>
                {result.missing.slice(0, 200).map((r) => (
                  <tr key={r.sku}>
                    <td dir="ltr" className="font-mono text-xs">{r.sku}</td>
                    <td className="!whitespace-normal max-w-md font-medium">{r.product_name ?? "—"}</td>
                    <td>{formatNumber(r.sap_stock ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CatalogPage() {
  const { t } = useLang();
  const fileRef = useRef<HTMLInputElement>(null);
  const [books, setBooks] = useState<CatalogBook[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");
  const [filterField, setFilterField] = useState<CatalogField | null>(null);

  async function handleFile(file: File) {
    setParsing(true);
    setError("");
    setFilterField(null);
    try {
      const parsed = parseCatalogFile(await file.arrayBuffer());
      if (!parsed.length) {
        setError(t("invalidFile"));
        setBooks(null);
      } else {
        setBooks(parsed);
        setFileName(file.name);
      }
    } catch {
      setError(t("invalidFile"));
      setBooks(null);
    }
    setParsing(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  const stats = useMemo(() => {
    if (!books) return null;
    const perField = CATALOG_FIELDS.map((f) => {
      const missing = books.filter((b) => !b[f]).length;
      return { field: f, missing, filled: books.length - missing, pct: books.length ? ((books.length - missing) / books.length) * 100 : 0 };
    }).sort((a, b) => a.pct - b.pct);
    const totalCells = books.length * CATALOG_FIELDS.length;
    const filledCells = perField.reduce((s, f) => s + f.filled, 0);
    return { perField, score: totalCells ? (filledCells / totalCells) * 100 : 0 };
  }, [books]);

  const filtered = useMemo(() => {
    if (!books) return [];
    if (!filterField) return books.filter((b) => CATALOG_FIELDS.some((f) => !b[f]));
    return books.filter((b) => !b[filterField]);
  }, [books, filterField]);

  function exportMissing() {
    if (!filtered.length) return;
    downloadCsv(
      `catalog-missing-${filterField ?? "any"}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        filtered.map((b) => ({
          sku: b.sku,
          name: b.name ?? "",
          missing_fields: CATALOG_FIELDS.filter((f) => !b[f]).map((f) => t(FIELD_LABEL[f])).join(" | "),
        }))
      )
    );
  }

  return (
    <div>
      <PageHeader title={t("catalog")} subtitle={t("catalogSubtitle")} />

      <div className="card p-6 mb-6">
        <div
          onClick={() => fileRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 p-8 text-center transition hover:border-brand-400 hover:bg-slate-50"
        >
          <UploadCloud className="h-10 w-10 text-brand-500" />
          <div className="font-semibold text-slate-700">{t("uploadCatalog")}</div>
          {fileName && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-700">
              <CheckCircle2 size={14} />
              <span dir="ltr">{fileName}</span>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </div>
        {error && <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">{error}</div>}
      </div>

      <SapVsWebsite catalogBooks={books} />

      {parsing ? (
        <Spinner />
      ) : !books || !stats ? null : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="card p-4 border-s-4 border-s-brand-500">
              <div className="text-xs font-semibold uppercase text-slate-500">{t("totalBooks")}</div>
              <div className="mt-1 text-2xl font-bold">{formatNumber(books.length)}</div>
            </div>
            <div className={cn("card p-4 border-s-4", stats.score >= 90 ? "border-s-emerald-500" : stats.score >= 70 ? "border-s-amber-500" : "border-s-red-500")}>
              <div className="text-xs font-semibold uppercase text-slate-500">{t("completenessScore")}</div>
              <div className="mt-1 text-2xl font-bold">{stats.score.toFixed(1)}%</div>
            </div>
            <div className="card p-4 border-s-4 border-s-red-500">
              <div className="text-xs font-semibold uppercase text-slate-500">{t("fieldsNeedReview")}</div>
              <div className="mt-1 text-2xl font-bold">{stats.perField.filter((f) => f.missing > 0).length}</div>
            </div>
            <div className="card p-4 border-s-4 border-s-amber-500">
              <div className="text-xs font-semibold uppercase text-slate-500">{t("missingCount")}</div>
              <div className="mt-1 text-2xl font-bold">{formatNumber(books.filter((b) => CATALOG_FIELDS.some((f) => !b[f])).length)}</div>
            </div>
          </div>

          <div className="card p-5">
            <h3 className="mb-4 text-sm font-bold text-slate-700">{t("fieldsNeedReview")}</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {stats.perField.map((f) => (
                <button
                  key={f.field}
                  onClick={() => setFilterField(filterField === f.field ? null : f.field)}
                  className={cn(
                    "rounded-xl border p-3 text-start transition hover:shadow-sm",
                    filterField === f.field ? "border-brand-400 ring-1 ring-brand-300" : "border-slate-200"
                  )}
                  title={t("showMissingOnly")}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-semibold">{t(FIELD_LABEL[f.field])}</span>
                    <span className={cn("text-xs font-bold", f.missing === 0 ? "text-emerald-600" : "text-red-600")} dir="ltr">
                      {f.missing === 0 ? "✓" : `${formatNumber(f.missing)} ${t("missingCount")}`}
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-100">
                    <div
                      className={cn("h-full rounded-full", f.pct >= 90 ? "bg-emerald-500" : f.pct >= 70 ? "bg-amber-500" : "bg-red-500")}
                      style={{ width: `${f.pct}%` }}
                    />
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400" dir="ltr">
                    {f.pct.toFixed(1)}% {t("filledCount")}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <BookOpen size={16} />
                {filterField ? `${t(FIELD_LABEL[filterField])} — ${t("missingCount")}` : t("fieldsNeedReview")} ({formatNumber(filtered.length)})
              </h3>
              <button className="btn-secondary !py-1.5 text-xs" onClick={exportMissing}>
                <Download size={14} />
                {t("exportMissing")}
              </button>
            </div>
            <div className="card overflow-x-auto max-h-[32rem] overflow-y-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{t("sku")}</th>
                    <th>{t("fldName")}</th>
                    <th>{t("missingCount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 300).map((b) => (
                    <tr key={b.sku}>
                      <td dir="ltr" className="font-mono text-xs">{b.sku}</td>
                      <td className="!whitespace-normal max-w-sm font-medium">{b.name ?? <span className="text-red-500">—</span>}</td>
                      <td className="!whitespace-normal max-w-md">
                        <div className="flex flex-wrap gap-1">
                          {CATALOG_FIELDS.filter((f) => !b[f]).map((f) => (
                            <span key={f} className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">
                              {t(FIELD_LABEL[f])}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
