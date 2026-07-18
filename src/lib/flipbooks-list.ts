import type { SupabaseClient } from "@supabase/supabase-js";

// Shared listing for hosted flipbooks — used by the Studio API (auth client)
// and the public /library page (anon client). Merges the storage objects with
// the metadata rows in public.flipbooks so both book formats are covered:
//   legacy: one self-contained {id}.html  (size comes from the storage object)
//   v2:     {id}.json manifest + binary pages under {id}/  (size/pages/cover
//           come from the metadata row, written at host time)

export interface FlipbookEntry {
  id: string;
  path: string; // storage key of the primary object ({id}.html or {id}.json)
  fmt: "html" | "v2";
  title: string;
  size: number;
  pages: number;
  createdAt: string;
  cover: string | null; // storage path of the cover thumbnail, if any
  rtl: boolean;
}

interface RootObject {
  name: string;
  created_at?: string | null;
  metadata?: { size?: number } | null;
}

// Storage returns at most 1000 objects per list call — a 3000-book library
// has to page through the bucket root until a short page comes back.
export async function listAllRootObjects(supabase: SupabaseClient): Promise<RootObject[]> {
  const all: RootObject[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 20000; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from("flipbooks")
      .list("", { limit: PAGE, offset, sortBy: { column: "created_at", order: "desc" } });
    if (error) throw new Error(error.message);
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

export async function listFlipbooks(supabase: SupabaseClient): Promise<FlipbookEntry[]> {
  const [objects, metaRes] = await Promise.all([
    listAllRootObjects(supabase),
    supabase.from("flipbooks").select("path, title, fmt, size_bytes, page_count, rtl, cover, created_at"),
  ]);
  const meta = new Map((metaRes.data || []).map((m) => [m.path as string, m]));

  const books: FlipbookEntry[] = [];
  for (const o of objects) {
    const isHtml = o.name.endsWith(".html");
    const isJson = o.name.endsWith(".json");
    if (!isHtml && !isJson) continue; // page folders appear as prefix rows — skip
    const id = o.name.replace(/\.(html|json)$/, "");
    const m = meta.get(o.name);
    books.push({
      id,
      path: o.name,
      fmt: isJson ? "v2" : "html",
      title: (m?.title as string) || id.replace(/-[0-9a-f]{8}$/, "").replace(/-/g, " "),
      size: isJson ? Number(m?.size_bytes) || 0 : o.metadata?.size || 0,
      pages: Number(m?.page_count) || 0,
      createdAt: o.created_at || (m?.created_at as string) || "",
      cover: m?.cover ? `${id}/${m.cover}` : null,
      rtl: m?.rtl !== false,
    });
  }
  books.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return books;
}
