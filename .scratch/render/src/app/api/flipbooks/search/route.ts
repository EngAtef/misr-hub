import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Public library search — matches book titles AND extracted in-book text via
// fn_library_search (SECURITY DEFINER), which returns only ids, never the
// stored text. Anonymous by design: the /library page is public.
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") || "").trim().slice(0, 100);
  if (q.length < 2) return NextResponse.json({ hits: [] });

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data, error } = await supabase.rpc("fn_library_search", { q });
    if (error) return NextResponse.json({ hits: [] });
    const hits = (data || []).map((r: { book_id: string; hit_text: boolean }) => ({
      id: r.book_id,
      inText: !!r.hit_text,
    }));
    return NextResponse.json(
      { hits },
      { headers: { "cache-control": "public, max-age=30, s-maxage=300" } }
    );
  } catch {
    return NextResponse.json({ hits: [] });
  }
}
