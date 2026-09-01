"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DateRange } from "@/components/date-range";

export function rangeParams(range: DateRange) {
  return {
    p_from: range.from ? `${range.from}T00:00:00Z` : null,
    p_to: range.to ? `${range.to}T23:59:59Z` : null,
  };
}

// One failed attempt used to leave the page silently empty until a manual
// refresh — an expired JWT right after opening the app, a proxy blip or a
// statement timeout on a cold cache all read as "no numbers". Every call now
// retries twice (spinner stays up meanwhile); an auth-looking error first
// waits for the client to refresh the session, which is what a manual page
// refresh was fixing by accident.
const RETRIES = 2;
const looksLikeAuth = (msg: string) => /jwt|token|not authenticated|401/i.test(msg);

export function useRpc<T>(fn: string, params: Record<string, unknown>, deps: unknown[], skip = false) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (skip) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      for (let tryNo = 0; ; tryNo++) {
        const { data, error } = await supabase.rpc(fn, params);
        if (cancelled) return;
        if (!error) {
          setError(null);
          setData(data as T);
          setLoading(false);
          return;
        }
        if (tryNo >= RETRIES) {
          setError(error.message);
          setData(null);
          setLoading(false);
          return;
        }
        if (looksLikeAuth(error.message ?? "")) {
          // getSession refreshes an expired access token before we retry
          await supabase.auth.getSession().catch(() => null);
        }
        await new Promise((r) => setTimeout(r, 800 * (tryNo + 1)));
        if (cancelled) return;
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, skip, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return { data, loading, error, retry };
}
