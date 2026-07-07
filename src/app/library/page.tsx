import { createClient } from "@supabase/supabase-js";
import { BookOpen } from "lucide-react";

// Public, shareable library of every hosted book — no login required.
// Rebuilt at most every 5 minutes so newly hosted books appear quickly.
export const revalidate = 300;

export const metadata = {
  title: "مكتبة نهضة مصر الرقمية — Nahdet Misr Online Library",
  description: "اقرأ كتب نهضة مصر ومعايناتها المجانية أونلاين",
};

interface LibraryBook {
  id: string;
  title: string;
  createdAt: string;
  isPreview: boolean;
}

async function getBooks(): Promise<LibraryBook[]> {
  let objects: { name: string; created_at?: string | null }[] | null = null;
  let meta: { path: string; title: string }[] | null = null;
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    ({ data: objects } = await supabase.storage
      .from("flipbooks")
      .list("", { limit: 1000, sortBy: { column: "created_at", order: "desc" } }));
    ({ data: meta } = await supabase.from("flipbooks").select("path, title"));
  } catch {
    // storage unreachable (e.g. at build time) — render the empty state
  }
  const titles = new Map((meta || []).map((m) => [m.path, m.title]));

  return (objects || [])
    .filter((o) => o.name.endsWith(".html"))
    .map((o) => {
      const id = o.name.replace(/\.html$/, "");
      const raw = titles.get(o.name) || id.replace(/-[0-9a-f]{8}$/, "").replace(/-/g, " ");
      const isPreview = /معاينة|preview/i.test(raw);
      return {
        id,
        title: raw.replace(/\s*[—-]\s*(معاينة|preview)\s*$/i, "").trim() || raw,
        createdAt: o.created_at || "",
        isPreview,
      };
    });
}

export default async function LibraryPage() {
  const books = await getBooks();

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50">
      <header className="bg-gradient-to-l from-indigo-950 via-indigo-800 to-violet-700 px-6 py-14 text-center text-white">
        <div className="mx-auto max-w-3xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-3xl">📚</div>
          <h1 className="text-3xl font-extrabold">مكتبة نهضة مصر الرقمية</h1>
          <p className="mt-3 text-sm text-white/70">
            اقرأ الكتب والمعاينات المجانية أونلاين مباشرة من المتصفح — Nahdet Misr online library
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">
        {books.length === 0 ? (
          <p className="py-16 text-center text-slate-400">لا توجد كتب منشورة بعد — عُد قريباً 📖</p>
        ) : (
          <>
            <p className="mb-5 text-sm text-slate-500">{books.length} كتاب متاح للقراءة</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {books.map((b) => (
                <a
                  key={b.id}
                  href={`/reader/${b.id}`}
                  target="_blank"
                  rel="noopener"
                  className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-lg"
                >
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
                  <h2 className="mb-1 font-bold leading-snug">{b.title}</h2>
                  {b.createdAt && (
                    <p className="text-xs text-slate-400" dir="ltr">
                      {new Date(b.createdAt).toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" })}
                    </p>
                  )}
                  <span className="mt-auto pt-4 text-sm font-semibold text-indigo-600 group-hover:underline">
                    اقرأ الآن ←
                  </span>
                </a>
              ))}
            </div>
          </>
        )}
      </main>

      <footer className="pb-8 text-center text-xs text-slate-400">دار نهضة مصر للنشر — Nahdet Misr Publishing</footer>
    </div>
  );
}
