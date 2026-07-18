import { createClient } from "@supabase/supabase-js";
import { listFlipbooks } from "@/lib/flipbooks-list";
import LibraryGrid, { type LibraryBook } from "./LibraryGrid";

// Public, shareable library of every hosted book — no login required.
// Rebuilt at most every 5 minutes so newly hosted books appear quickly.
export const revalidate = 300;

export const metadata = {
  title: "مكتبة نهضة مصر الرقمية — Nahdet Misr Online Library",
  description: "اقرأ كتب نهضة مصر ومعايناتها المجانية أونلاين",
};

async function getBooks(): Promise<LibraryBook[]> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const entries = await listFlipbooks(supabase);
    const storageBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/flipbooks`;
    return entries.map((e) => {
      const isPreview = /معاينة|preview/i.test(e.title);
      return {
        id: e.id,
        title: e.title.replace(/\s*[—-]\s*(معاينة|preview)\s*$/i, "").trim() || e.title,
        createdAt: e.createdAt,
        isPreview,
        coverUrl: e.cover ? `${storageBase}/${e.cover}` : null,
        pages: e.pages,
      };
    });
  } catch {
    // storage unreachable (e.g. at build time) — render the empty state
    return [];
  }
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
          <LibraryGrid books={books} />
        )}
      </main>

      <footer className="pb-8 text-center text-xs text-slate-400">دار نهضة مصر للنشر — Nahdet Misr Publishing</footer>
    </div>
  );
}
