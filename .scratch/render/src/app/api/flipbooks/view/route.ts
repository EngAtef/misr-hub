import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;

// Anonymous view beacon from the public reader (navigator.sendBeacon).
// Counts via a SECURITY DEFINER function — the anon key can only increment,
// never read or rewrite the counters.
export async function POST(request: NextRequest) {
  let id = "";
  try {
    id = (await request.text()).trim();
  } catch {
    // empty body — ignored below
  }
  if (ID_RE.test(id)) {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/fn_flipbook_view`, {
        method: "POST",
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ p_id: id }),
      });
    } catch {
      // a lost beacon is fine
    }
  }
  return new NextResponse(null, { status: 204 });
}
