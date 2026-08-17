"use client";

import { attrLabel, attrClass } from "@/lib/attribution";

// Where the customer came from — GA4 session source written onto the order
// (orders.attr_bucket, migration 109). Null = GA4 never saw the purchase.
// Hover shows the raw source / medium and the campaign name.
export function AttrBadge({
  bucket,
  source,
  medium,
  campaign,
  lang,
  size = "sm",
}: {
  bucket: string | null | undefined;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  lang: "ar" | "en";
  size?: "sm" | "md";
}) {
  const title = [source && medium ? `${source} / ${medium}` : null, campaign].filter(Boolean).join(" · ");
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full font-semibold ${attrClass(bucket)} ${
        size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]"
      }`}
      title={title || undefined}
    >
      {attrLabel(bucket, lang)}
    </span>
  );
}
