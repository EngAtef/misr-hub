"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DateRange } from "@/components/date-range";

export function rangeParams(range: DateRange) {
  return {
    p_from: range.from ? `${range.from}T00:00:00Z` : null,
    p_to: range.to ? `${range.to}T23:59:59Z` : null,
  };
}

export function useRpc<T>(fn: string, params: Record<string, unknown>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase
      .rpc(fn, params)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setError(error.message);
          setData(null);
        } else {
          setError(null);
          setData(data as T);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}
