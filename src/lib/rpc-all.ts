import type { SupabaseClient } from "@supabase/supabase-js";

// PostgREST silently truncates any response at max-rows (1,000 on this
// project). An RPC asked for 50,000 rows returns 1,000 with no error, so a
// segment of 4,734 people exported as exactly 1,000. Page with .range()
// until a short page comes back — the same pattern the export routes use.
export async function rpcAll<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  opts: { pageSize?: number; max?: number } = {}
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 1000;
  const max = opts.max ?? 200000;
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.rpc(fn, args).range(offset, offset + pageSize - 1);
    if (error) throw error;
    const rows = (data as T[] | null) ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
    if (offset >= max) break;
  }
  return out;
}
