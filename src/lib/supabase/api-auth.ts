import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export type Role = "admin" | "manager" | "viewer";

export interface ApiUser {
  id: string;
  email: string;
  role: Role;
}

// Authenticates an API request from cookies and returns the caller's
// profile role, or null if not signed in / inactive.
export async function getApiUser(request: NextRequest): Promise<ApiUser | null> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active, email")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active) return null;

  return { id: user.id, email: profile.email ?? user.email ?? "", role: profile.role as Role };
}
