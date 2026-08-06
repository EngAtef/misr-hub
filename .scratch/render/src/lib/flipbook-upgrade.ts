import { flipbookViewerTemplate } from "./flipbook-viewer-template";

// Books hosted before the two-page viewer shipped were generated with the old
// dark single-page template. Their page images live in a `var PAGES = [...]`
// JSON array, so we can lift the pages out and re-render them into the current
// viewer (spread, zoom, arrows, watermark) at serve time — same URL, no
// re-hosting. Returns null when the book is already current (or isn't a
// flipbook we recognise), in which case the caller serves the original HTML.
export function upgradeLegacyFlipbook(html: string): string | null {
  if (html.includes('id="zoomWrap"')) return null; // already the current viewer

  const marker = "var PAGES = ";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const from = start + marker.length;
  const end = html.indexOf("];", from); // data-URI pages never contain "]"
  if (end < 0) return null;

  let pages: unknown;
  try {
    pages = JSON.parse(html.slice(from, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(pages) || pages.length === 0 || pages.some((p) => typeof p !== "string")) {
    return null;
  }

  // Title was already HTML-escaped when the book was generated — reuse as-is.
  const tMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const title = (tMatch ? tMatch[1] : "").trim() || "Book";

  // Legacy books carry no direction flag. Arabic letters in the title (with
  // the generic preview-suffix words ignored) are the best available signal.
  const rtl = /[؀-ۿ]/.test(title.replace(/معاينة|نسخة/g, ""));

  let out = flipbookViewerTemplate()
    .split("__TITLE__").join(title)
    .split("__RTL__").join(rtl ? "true" : "false")
    .split("__LANG__").join(rtl ? "ar" : "en")
    .split("__PAGES__").join(JSON.stringify(pages));

  // Free-preview books have a floating "get the full book" buy button
  // injected after the template — carry it over.
  const buy = html.match(/<a href="[^"]*" target="_top"[^>]*>[\s\S]*?<\/a>/);
  if (buy && /position:fixed/.test(buy[0])) {
    out = out.replace("</body>", buy[0] + "\n</body>");
  }
  return out;
}
