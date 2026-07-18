"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface ActivityEvent {
  user_id: string;
  user_email: string;
  kind: "visit" | "click" | "action";
  page: string;
  label: string | null;
  detail: Record<string, unknown> | null;
}

const FLUSH_INTERVAL = 8000;
const FLUSH_AT = 20;

/**
 * Invisible usage tracker mounted once in the app shell.
 * Records page visits and clicks on interactive elements, batches them and
 * writes to user_activity (RLS: users insert only their own rows, only the
 * owner can read). Renders nothing and swallows every error.
 */
export function ActivityTracker({ userId, email }: { userId: string; email: string }) {
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);
  const queue = useRef<ActivityEvent[]>([]);
  const flushing = useRef(false);

  const push = useRef((e: Omit<ActivityEvent, "user_id" | "user_email">) => {
    queue.current.push({ ...e, user_id: userId, user_email: email });
  });

  useEffect(() => {
    push.current = (e) => {
      queue.current.push({ ...e, user_id: userId, user_email: email });
    };
  }, [userId, email]);

  useEffect(() => {
    const flush = async () => {
      if (flushing.current || queue.current.length === 0) return;
      flushing.current = true;
      const batch = queue.current.splice(0, queue.current.length);
      try {
        await supabase.from("user_activity").insert(batch);
      } catch {
        // tracking must never surface errors to the user
      } finally {
        flushing.current = false;
      }
    };

    const onClick = (ev: MouseEvent) => {
      const target = (ev.target as HTMLElement | null)?.closest?.(
        "button, a, [role='button'], input[type='checkbox'], select, th"
      ) as HTMLElement | null;
      if (!target) return;
      const label =
        target.getAttribute("aria-label") ||
        target.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ||
        (target as HTMLInputElement).placeholder ||
        target.tagName.toLowerCase();
      const href = target.getAttribute("href");
      push.current({
        kind: "click",
        page: window.location.pathname,
        label: label || null,
        detail: href ? { href } : null,
      });
      if (queue.current.length >= FLUSH_AT) flush();
    };

    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onHide);
    const timer = setInterval(flush, FLUSH_INTERVAL);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onHide);
      clearInterval(timer);
      flush();
    };
  }, [supabase]);

  useEffect(() => {
    push.current({ kind: "visit", page: pathname, label: null, detail: null });
  }, [pathname]);

  return null;
}
