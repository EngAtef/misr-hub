"use client";

import { cn } from "@/lib/utils";

// Nahdet Misr Bookstore wordmark per the CI guide:
// navy serif "NAHDET MISR" over a teal BOOKSTORE banner.
export function Logo({ onDark = false, size = "md" }: { onDark?: boolean; size?: "md" | "lg" }) {
  return (
    <div className="flex flex-col items-start leading-none select-none" dir="ltr">
      <span
        className={cn(
          "font-serif font-bold tracking-[0.08em]",
          size === "lg" ? "text-2xl" : "text-base",
          onDark ? "text-white" : "text-brand-800"
        )}
      >
        NAHDET MISR
      </span>
      <span
        className={cn(
          "mt-1 bg-gold text-white font-serif tracking-[0.35em] uppercase",
          size === "lg" ? "text-[11px] px-3 py-1" : "text-[9px] px-2 py-0.5"
        )}
      >
        Bookstore
      </span>
    </div>
  );
}
