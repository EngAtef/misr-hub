"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** The signed-in user's role ("admin" | "manager" | "viewer"), null while loading. */
export function useMyRole(): string | null {
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single()
        .then(({ data }) => setRole((data as { role?: string } | null)?.role ?? null));
    });
  }, []);
  return role;
}
