"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Search, ShoppingCart, X } from "lucide-react";

export interface LibraryBook {
  id: string;
  title: string;
  createdAt: string;
  isPreview: boolean;
  coverUrl: string | null;
  pages: number;
  category: string | null;
  buyUrl: string | null;
}

// Client half of the public library: instant title search + category chips,
// plus a debounced server call that also searches INSIDE books (extracted
// text), and a windowed "show more" grid so the first paint stays light.
const PAGE_SIZE = 60;

export default function LibraryGrid({ books }: { books: LibraryBook[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [textHits, setTextHits] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const categories = useMemo(
    () => [...new Set(books.map((b) => b.category).filter(Boolean))] as string[],
    [books]
  );

  const norm = query.trim().toLowerCase();

  // Deep search: match inside extracted book text via the public API.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (norm.length < 2) {
      setTextHits(new Set());
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/flipbooks/search?q=${encodeURIComponent(norm)}`);
        if (!res.ok) return;
        const j = (await res.json()) as { hits?: { id: string; inText: boolean }[] };
        setTextHits(new Set((j.hits || []).filter((h) => h.inText).map((h) => h.id)));
      } catch {
        // title matching still works without the deep search
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [norm]);

  const filtered = useMemo(() => {
    let list = books;
    if (category) list = list.filter((b) => b.category === category);
    if (norm) list = list.filter((b) => b.title.toLowerCase().includes(norm) || textHits.has(b.id));
    return list;
  }, [books, category, norm, textHits]);
  const shown = filtered.slice(0, limit);

  function openBook(id: string) {
    window.open(`/reader/${id}`, "_blank", "noopener");
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pe-10 ps-4 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            placeholder="ابحث بالعنوان أو داخل نص الكتاب..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE_SIZE);
            }}
          />
          {query && (
            <button
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              onClick={() => setQuery("")}
              aria-label="مسح البحث"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <p className="text-sm text-slate-500">
          {norm || category ? `${filtered.length} نتيجة من ${books.length} كتاب` : `${books.length} كتاب متاح للقراءة`}
        </p>
      </div>

      {categories.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <button
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              category === "" ? "bg-indigo-600 text-white" : "bg-white text-slate-600 shadow-sm hover:bg-indigo-50"
            }`}
            onClick={() => {
              setCategory("");
              setLimit(PAGE_SIZE);
            }}
          >
            الكل
          </button>
          {categories.map((c) => (
            <button
              key={c}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                category === c ? "bg-indigo-600 text-white" : "bg-white text-slate-600 shadow-sm hover:bg-indigo-50"
              }`}
              onClick={() => {
                setCategory(category === c ? "" : c);
                setLimit(PAGE_SIZE);
              }}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="py-16 text-center text-slate-400">لا توجد كتب مطابقة للبحث 🔍</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((b) => (
              <div
                key={b.id}
                role="link"
                tabIndex={0}
                onClick={() => openBook(b.id)}
                onKeyDown={(e) => e.key === "Enter" && openBook(b.id)}
                className="card group flex cursor-pointer flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                {b.coverUrl ? (
                  <div className="relative h-44 w-full overflow-hidden bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={b.coverUrl}
                      alt={b.title}
                      loading="lazy"
                      className="h-full w-full object-cover object-top transition group-hover:scale-[1.02]"
                    />
                    {b.isPreview && (
                      <span className="absolute right-2 top-2 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                        معاينة مجانية
                      </span>
                    )}
                  </div>
                ) : null}
                <div className="flex flex-1 flex-col p-5">
                  {!b.coverUrl && (
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                        <BookOpen size={20} />
                      </span>
                      {b.isPreview && (
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                          معاينة مجانية
                        </span>
                      )}
                    </div>
                  )}
                  <h2 className="mb-1 font-bold leading-snug">{b.title}</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-slate-400" dir="ltr">
                      {b.createdAt &&
                        new Date(b.createdAt).toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" })}
                      {b.pages > 0 && ` · ${b.pages} صفحة`}
                    </p>
                    {b.category && (
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600">
                        {b.category}
                      </span>
                    )}
                    {norm && textHits.has(b.id) && !b.title.toLowerCase().includes(norm) && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                        وُجد داخل الكتاب
                      </span>
                    )}
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                    <span className="text-sm font-semibold text-indigo-600 group-hover:underline">اقرأ الآن ←</span>
                    {b.buyUrl && (
                      <a
                        href={b.buyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 rounded-full bg-amber-400 px-3 py-1.5 text-xs font-bold text-amber-950 transition hover:bg-amber-500"
                      >
                        <ShoppingCart size={13} />
                        اشترِ الكتاب
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {filtered.length > limit && (
            <div className="mt-8 text-center">
              <button
                className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
                onClick={() => setLimit((l) => l + PAGE_SIZE)}
              >
                عرض المزيد ({filtered.length - limit})
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
