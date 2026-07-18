"use client";

import { useMemo, useState } from "react";
import { BookOpen, Search, X } from "lucide-react";

export interface LibraryBook {
  id: string;
  title: string;
  createdAt: string;
  isPreview: boolean;
  coverUrl: string | null;
  pages: number;
}

// Client half of the public library: instant search over the full catalogue
// (titles are a tiny payload even at 3000 books) + a windowed "show more"
// grid so the first paint stays light.
const PAGE_SIZE = 60;

export default function LibraryGrid({ books }: { books: LibraryBook[] }) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const norm = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (norm ? books.filter((b) => b.title.toLowerCase().includes(norm)) : books),
    [books, norm]
  );
  const shown = filtered.slice(0, limit);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pe-10 ps-4 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            placeholder="ابحث عن كتاب بالاسم..."
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
          {norm ? `${filtered.length} نتيجة من ${books.length} كتاب` : `${books.length} كتاب متاح للقراءة`}
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="py-16 text-center text-slate-400">لا توجد كتب مطابقة للبحث 🔍</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((b) => (
              <a
                key={b.id}
                href={`/reader/${b.id}`}
                target="_blank"
                rel="noopener"
                className="card group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg"
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
                  <p className="text-xs text-slate-400" dir="ltr">
                    {b.createdAt &&
                      new Date(b.createdAt).toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" })}
                    {b.pages > 0 && ` · ${b.pages} صفحة`}
                  </p>
                  <span className="mt-auto pt-4 text-sm font-semibold text-indigo-600 group-hover:underline">
                    اقرأ الآن ←
                  </span>
                </div>
              </a>
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
