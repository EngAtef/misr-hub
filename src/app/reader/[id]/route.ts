import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// Public book reader. Streams a hosted flipbook out of Supabase Storage with
// real text/html headers (Storage itself serves HTML as text/plain), so the
// URL can be embedded in an <iframe> on any external site.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) {
    return new Response("Not found", { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/flipbooks/${id}.html`,
      { cache: "no-store" }
    );
  } catch {
    return new Response("Book storage is unreachable", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response("Not found", { status: 404 });
  }

  // Each upload gets a fresh id, so the content behind a URL never changes.
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=31536000, immutable",
      "content-security-policy": "frame-ancestors *",
      "x-robots-tag": "noindex",
    },
  });
}
