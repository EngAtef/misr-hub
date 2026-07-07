import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/api-auth";

export const dynamic = "force-dynamic";

// ASCII-only slug for the storage key; Arabic titles fall back to "book".
function slugify(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/\.html?$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// POST { filename } -> a one-time signed upload URL for the flipbooks bucket
// plus the public reader URL to embed. The browser uploads directly to
// Supabase Storage, so file size is not limited by the serverless body cap.
export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let filename = "";
  try {
    const body = await request.json();
    filename = typeof body?.filename === "string" ? body.filename : "";
  } catch {
    // no body — fall back to the default slug
  }

  const slug = slugify(filename) || "book";
  const id = `${slug}-${crypto.randomUUID().slice(0, 8)}`;

  const { data, error } = await user.supabase.storage
    .from("flipbooks")
    .createSignedUploadUrl(`${id}.html`);
  if (error || !data) {
    return NextResponse.json({ error: error?.message || "could not sign upload" }, { status: 500 });
  }

  return NextResponse.json({
    id,
    uploadUrl: data.signedUrl,
    readerUrl: `${request.nextUrl.origin}/reader/${id}`,
  });
}
