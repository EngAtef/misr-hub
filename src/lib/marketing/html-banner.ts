// HTML/CSS → image banner renderer (html2canvas). The templates live in
// banner-templates.js (plain JS so the design-test harness can load them in
// a bare browser too). Client-side only.
import { bannerHtml, makeBlurredBg, canvaTemplateUrl } from "./banner-templates.js";
import type { AssetFmt, AssetInput } from "./asset-engine";

interface Palette { bg1: string; bg2: string; text: string; sub: string; accent: string; footer: string; footerText: string }

export async function renderHtmlBanner(
  fmt: AssetFmt,
  W: number,
  H: number,
  palette: Palette,
  input: AssetInput
): Promise<Blob> {
  const html2canvas = (await import("html2canvas")).default;
  try { await document.fonts.ready; } catch { /* older browsers */ }

  const layout = input.layout ?? "promo";
  const blurredBg = input.cover ? (makeBlurredBg(input.cover, W, H) as string) : "";
  const fontFamily = getComputedStyle(document.body).fontFamily || "Cairo, sans-serif";
  const tplUrl = layout.startsWith("tpl-")
    ? (canvaTemplateUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, layout.slice(4)) as string)
    : "";

  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${W}px;height:${H}px;z-index:-1;`;
  host.innerHTML = bannerHtml(layout, fmt, W, H, {
    coverSrc: input.cover?.src ?? "",
    blurredBg,
    tplUrl,
    title: input.title,
    hook: input.hook,
    cta: input.cta,
    badge: input.badge ?? "",
    palette,
    fontFamily,
  }) as string;
  document.body.appendChild(host);

  try {
    // Let the embedded <img> elements decode before capturing.
    await Promise.all(
      Array.from(host.querySelectorAll("img")).map((im) =>
        im.complete ? Promise.resolve() : new Promise((ok) => { im.onload = im.onerror = () => ok(null); })
      )
    );
    const canvas = await html2canvas(host.firstChild as HTMLElement, {
      width: W, height: H, scale: 1, useCORS: true, logging: false, backgroundColor: "#0b0e1e",
    });
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.92);
    });
  } finally {
    host.remove();
  }
}
