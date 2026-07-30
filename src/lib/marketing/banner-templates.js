// HTML/CSS banner templates for the Marketing Studio — rendered to images by
// html2canvas. Plain JS module (no TS syntax) so the standalone design-test
// harness can import it directly in a browser too.
//
// html2canvas-safe CSS only: gradients, border-radius, box-shadow,
// text-shadow, transforms, borders. NO clip-path / filter / object-fit —
// blur is pre-baked into a backdrop image via canvas (makeBlurredBg).

// Cover-crop draw of an image onto a downscaled, blurred, darkened canvas —
// returns a JPEG data URL used as the atmospheric backdrop.
export function makeBlurredBg(img, W, H, opts = {}) {
  const scale = 0.25; // downscale = extra softness + speed
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(W * scale));
  c.height = Math.max(2, Math.round(H * scale));
  const x = c.getContext("2d");
  x.filter = `blur(${opts.blur ?? 12}px) brightness(${opts.brightness ?? 0.58}) saturate(1.2)`;
  const s = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight);
  const sw = c.width / s, sh = c.height / s;
  x.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, -8, -8, c.width + 16, c.height + 16);
  return c.toDataURL("image/jpeg", 0.7);
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Split the hook into two display lines (white + accent).
function splitHook(hook, title) {
  const words = String(hook ?? "").split(/\s+/).filter(Boolean);
  if (words.length < 2) return { l1: hook || "", l2: title || "" };
  const mid = Math.ceil(words.length / 2);
  return { l1: words.slice(0, mid).join(" "), l2: words.slice(mid).join(" ") };
}

// Discount ribbon with a swallowtail bottom edge (two CSS border triangles).
function ribbonHtml(badge, u, p) {
  if (!badge) return "";
  const parts = String(badge).trim().split(/\s+/);
  const small = parts.length > 1 ? parts[0] : "";
  const big = parts.length > 1 ? parts.slice(1).join(" ") : parts[0];
  const rw = Math.round(180 * u);
  const half = Math.round(rw / 2);
  return `
  <div style="position:absolute;top:0;right:${Math.round(52 * u)}px;width:${rw}px;text-align:center;z-index:6;">
    <div style="background:linear-gradient(180deg,${p.accent},${shade(p.accent, -22)});padding:${Math.round(20 * u)}px ${Math.round(6 * u)}px ${Math.round(16 * u)}px;box-shadow:0 ${Math.round(10 * u)}px ${Math.round(28 * u)}px rgba(0,0,0,.4);color:#fff;">
      ${small ? `<div style="font-size:${Math.round(30 * u)}px;font-weight:700;line-height:1.25;">${esc(small)}</div>` : ""}
      <div style="font-size:${Math.round(58 * u)}px;font-weight:900;line-height:1.15;">${esc(big)}</div>
    </div>
    <div style="height:0;line-height:0;font-size:0;">
      <div style="display:inline-block;vertical-align:top;width:0;height:0;border-top:${Math.round(30 * u)}px solid ${shade(p.accent, -22)};border-right:${half}px solid transparent;"></div><div style="display:inline-block;vertical-align:top;width:0;height:0;border-top:${Math.round(30 * u)}px solid ${shade(p.accent, -22)};border-left:${half}px solid transparent;"></div>
    </div>
  </div>`;
}

// Lighten (+pct) or darken (-pct) a #rrggbb color.
function shade(hex, pct) {
  const n = parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return hex;
  const f = pct / 100;
  const ch = (v) => {
    const t = f < 0 ? 0 : 255;
    const out = Math.round(v + (t - v) * Math.abs(f));
    return Math.max(0, Math.min(255, out));
  };
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function orderPill(u, p, y) {
  return `
  <div style="position:absolute;top:${y}px;left:${Math.round(48 * u)}px;z-index:6;background:linear-gradient(135deg,${shade(p.accent, 8)},${shade(p.accent, -18)});border:${Math.max(2, Math.round(3 * u))}px solid rgba(255,255,255,.92);border-radius:999px;padding:${Math.round(14 * u)}px ${Math.round(38 * u)}px;color:#fff;font-weight:800;font-size:${Math.round(34 * u)}px;box-shadow:0 ${Math.round(10 * u)}px ${Math.round(26 * u)}px rgba(0,0,0,.38);">
    🛒 اطلب اونلاين
  </div>`;
}

function footerBar(u, p, W, H, termsColor) {
  const fw = Math.round(W * 0.72);
  return `
  <div style="position:absolute;bottom:${Math.round(H * 0.028)}px;left:${Math.round((W - fw) / 2)}px;width:${fw}px;z-index:6;background:rgba(7,9,22,.93);border:1px solid rgba(255,255,255,.28);border-radius:${Math.round(20 * u)}px;box-shadow:0 ${Math.round(12 * u)}px ${Math.round(30 * u)}px rgba(0,0,0,.45);padding:${Math.round(16 * u)}px ${Math.round(26 * u)}px;">
    <table style="width:100%;border-collapse:collapse;"><tr>
      <td style="text-align:right;vertical-align:middle;">
        <div style="color:#fff;font-weight:900;font-size:${Math.round(32 * u)}px;line-height:1.3;">متجر نهضة مصر</div>
        <div style="color:${shade(p.accent, 25)};font-weight:700;font-size:${Math.round(23 * u)}px;line-height:1.3;">nahdetmisrbookstore.com</div>
      </td>
      <td style="text-align:left;vertical-align:middle;white-space:nowrap;">
        <span style="display:inline-block;border:1px solid rgba(255,255,255,.55);border-radius:${Math.round(10 * u)}px;color:#fff;font-size:${Math.round(19 * u)}px;font-weight:700;padding:${Math.round(7 * u)}px ${Math.round(14 * u)}px;margin-left:${Math.round(8 * u)}px;">​ App Store</span>
        <span style="display:inline-block;border:1px solid rgba(255,255,255,.55);border-radius:${Math.round(10 * u)}px;color:#fff;font-size:${Math.round(19 * u)}px;font-weight:700;padding:${Math.round(7 * u)}px ${Math.round(14 * u)}px;">▶ Google Play</span>
      </td>
    </tr></table>
  </div>
  <div style="position:absolute;bottom:${Math.round(10 * u)}px;left:${Math.round(48 * u)}px;color:${termsColor || "rgba(255,255,255,.72)"};font-size:${Math.round(19 * u)}px;z-index:6;">تطبق الشروط والأحكام</div>`;
}

// ---------------------------------------------------------------------------
// PROMO — the store-campaign look: blurred backdrop, pill + ribbon, two-tone
// hook, floating cover with reflection, identity footer.
function promoHtml(fmt, W, H, o) {
  const u = Math.min(W, H) / 1080;
  const p = o.palette;
  const { l1, l2 } = splitHook(o.hook, o.title);
  const link = fmt === "link";
  const story = fmt === "story";
  const hookTop = Math.round(H * (story ? 0.15 : link ? 0.14 : 0.16));
  const coverTop = Math.round(H * (story ? 0.34 : link ? 0.3 : 0.35));
  // Cover width from the vertical budget (covers ≈ 3:4), so tall covers
  // never collide with the footer bar.
  const coverZone = H * (story ? 0.5 : link ? 0.48 : 0.44) - 96 * u;
  const coverW = Math.round(Math.min(W * (link ? 0.21 : 0.46), coverZone * 0.72));

  return `
  <div style="position:absolute;top:-6%;left:-6%;width:112%;height:112%;">
    <img src="${o.blurredBg}" style="width:100%;height:100%;" />
  </div>
  <div style="position:absolute;top:0;left:0;width:100%;height:100%;background:linear-gradient(180deg,rgba(8,10,26,.42) 0%,rgba(8,10,26,.18) 32%,rgba(4,5,16,.68) 88%);"></div>
  ${orderPill(u, p, Math.round(H * 0.035))}
  ${ribbonHtml(o.badge, u, p)}
  <div style="position:absolute;top:${hookTop}px;left:0;width:100%;text-align:center;z-index:5;padding:0 ${Math.round(W * 0.07)}px;box-sizing:border-box;">
    <div style="color:#fff;font-weight:700;font-size:${Math.round((link ? 44 : 52) * u)}px;line-height:1.55;text-shadow:0 4px 20px rgba(0,0,0,.6);">${esc(l1)}</div>
    <div style="color:${shade(p.accent, 30)};font-weight:900;font-size:${Math.round((link ? 56 : 68) * u)}px;line-height:1.45;text-shadow:0 6px 24px rgba(0,0,0,.6);">${esc(l2)}</div>
  </div>
  ${o.coverSrc ? `
  <div style="position:absolute;top:${coverTop}px;left:${Math.round((W - coverW) / 2)}px;width:${coverW}px;z-index:4;">
    <img src="${o.coverSrc}" style="width:100%;border-radius:${Math.round(12 * u)}px;border:2px solid rgba(255,255,255,.3);box-shadow:0 ${Math.round(38 * u)}px ${Math.round(70 * u)}px rgba(0,0,0,.6);" />
    <div style="height:${Math.round(90 * u)}px;overflow:hidden;position:relative;margin-top:${Math.round(6 * u)}px;">
      <img src="${o.coverSrc}" style="width:100%;transform:scaleY(-1);border-radius:${Math.round(12 * u)}px;opacity:.3;" />
      <div style="position:absolute;top:0;left:0;width:100%;height:100%;background:linear-gradient(180deg,rgba(10,12,28,.25) 0%,rgba(10,12,28,1) 92%);"></div>
    </div>
  </div>` : ""}
  ${footerBar(u, p, W, H)}`;
}

// ---------------------------------------------------------------------------
// MODERN — bold gradient poster: oversized glow circles, tilted cover card,
// highlight-marked hook, circular badge.
function modernHtml(fmt, W, H, o) {
  const u = Math.min(W, H) / 1080;
  const p = o.palette;
  const { l1, l2 } = splitHook(o.hook, o.title);
  const link = fmt === "link";
  const story = fmt === "story";
  const hookTopF = story ? 0.58 : link ? 0.24 : 0.58;
  const coverTopF = story ? 0.16 : link ? 0.16 : 0.13;
  // Fit the tilted card (cover ≈ 3:4 + white mat) inside the space above the
  // hook block so they never overlap.
  const coverZone = link ? H * 0.6 : H * (hookTopF - coverTopF - 0.03);
  const coverW = Math.round(Math.min(W * (link ? 0.22 : 0.4), coverZone * 0.7));
  const badgeSize = Math.round(160 * u);

  return `
  <div style="position:absolute;top:0;left:0;width:100%;height:100%;background:linear-gradient(135deg,${p.bg1} 0%,${p.bg2} 100%);"></div>
  <div style="position:absolute;top:-${Math.round(220 * u)}px;right:-${Math.round(180 * u)}px;width:${Math.round(560 * u)}px;height:${Math.round(560 * u)}px;border-radius:50%;background:${p.accent};opacity:.16;"></div>
  <div style="position:absolute;bottom:-${Math.round(200 * u)}px;left:-${Math.round(160 * u)}px;width:${Math.round(480 * u)}px;height:${Math.round(480 * u)}px;border-radius:50%;background:${p.accent};opacity:.12;"></div>
  <div style="position:absolute;top:${Math.round(H * 0.09)}px;left:0;width:100%;height:2px;"></div>
  ${o.coverSrc ? `
  <div style="position:absolute;top:${Math.round(H * coverTopF)}px;left:${Math.round(W * (link ? 0.1 : 0.5) - (link ? 0 : coverW / 2))}px;width:${coverW}px;transform:rotate(-5deg);z-index:4;">
    <div style="background:#fff;padding:${Math.round(14 * u)}px;border-radius:${Math.round(14 * u)}px;box-shadow:0 ${Math.round(40 * u)}px ${Math.round(80 * u)}px rgba(0,0,0,.45);">
      <img src="${o.coverSrc}" style="width:100%;border-radius:${Math.round(6 * u)}px;" />
    </div>
  </div>` : ""}
  ${o.badge ? `
  <div style="position:absolute;top:${Math.round(H * 0.05)}px;left:${Math.round(W * 0.055)}px;width:${badgeSize}px;height:${badgeSize}px;border-radius:50%;background:linear-gradient(135deg,${shade(p.accent, 12)},${shade(p.accent, -20)});border:${Math.max(2, Math.round(4 * u))}px solid rgba(255,255,255,.9);box-shadow:0 ${Math.round(14 * u)}px ${Math.round(34 * u)}px rgba(0,0,0,.4);z-index:6;">
    <table style="width:100%;height:100%;border-collapse:collapse;"><tr><td style="text-align:center;vertical-align:middle;color:#fff;font-weight:900;font-size:${Math.round(34 * u)}px;line-height:1.25;">${esc(o.badge).split(/\s+/).join("<br/>")}</td></tr></table>
  </div>` : ""}
  <div style="position:absolute;top:${Math.round(H * hookTopF)}px;${link ? `right:${Math.round(W * 0.06)}px;width:${Math.round(W * 0.52)}px;text-align:right;` : `left:0;width:100%;text-align:center;padding:0 ${Math.round(W * 0.08)}px;box-sizing:border-box;`}z-index:5;">
    <div style="color:${p.text};font-weight:800;font-size:${Math.round((link ? 46 : 54) * u)}px;line-height:1.6;">${esc(l1)}</div>
    <div style="display:inline-block;background:${p.accent};color:#fff;font-weight:900;font-size:${Math.round((link ? 54 : 62) * u)}px;line-height:1.5;padding:${Math.round(4 * u)}px ${Math.round(26 * u)}px;border-radius:${Math.round(10 * u)}px;margin-top:${Math.round(10 * u)}px;box-shadow:0 ${Math.round(10 * u)}px ${Math.round(26 * u)}px rgba(0,0,0,.25);">${esc(l2)}</div>
    <div style="color:${p.sub};font-weight:700;font-size:${Math.round(30 * u)}px;margin-top:${Math.round(22 * u)}px;">${esc(o.cta)}</div>
  </div>
  <div style="position:absolute;bottom:${Math.round(H * 0.03)}px;left:0;width:100%;text-align:center;z-index:5;">
    <span style="color:${p.text};font-weight:900;font-size:${Math.round(28 * u)}px;">متجر نهضة مصر</span>
    <span style="color:${p.accent};font-weight:900;font-size:${Math.round(28 * u)}px;"> • </span>
    <span style="color:${p.sub};font-weight:700;font-size:${Math.round(24 * u)}px;">nahdetmisrbookstore.com</span>
  </div>`;
}

// ---------------------------------------------------------------------------
// ELEGANT — dark luxury: double gold frame, glowing centered cover, ornament.
function elegantHtml(fmt, W, H, o) {
  const u = Math.min(W, H) / 1080;
  const gold = "#d9a441";
  const { l1, l2 } = splitHook(o.hook, o.title);
  const link = fmt === "link";
  const story = fmt === "story";
  const coverTopF = story ? 0.2 : link ? 0.17 : 0.19;
  const titleTopF = story ? 0.62 : link ? 0.62 : 0.65;
  // Aspect-aware width so tall covers never run into the title block.
  const coverZone = H * (titleTopF - coverTopF - 0.03);
  const coverW = Math.round(Math.min(W * (link ? 0.185 : 0.38), coverZone * 0.75));
  const m1 = Math.round(34 * u), m2 = Math.round(46 * u);

  return `
  <div style="position:absolute;top:0;left:0;width:100%;height:100%;background:linear-gradient(180deg,#131629 0%,#0a0c1a 100%);"></div>
  <div style="position:absolute;top:20%;left:15%;width:70%;height:55%;border-radius:50%;background:${gold};opacity:.07;"></div>
  <div style="position:absolute;top:${m1}px;left:${m1}px;right:${m1}px;bottom:${m1}px;border:1px solid rgba(217,164,65,.65);"></div>
  <div style="position:absolute;top:${m2}px;left:${m2}px;right:${m2}px;bottom:${m2}px;border:1px solid rgba(217,164,65,.3);"></div>
  <div style="position:absolute;top:${Math.round(H * (story ? 0.085 : 0.075))}px;left:0;width:100%;text-align:center;color:${gold};font-size:${Math.round(30 * u)}px;letter-spacing:${Math.round(8 * u)}px;z-index:5;">✦ ✦ ✦</div>
  ${o.badge ? `<div style="position:absolute;top:${Math.round(H * (story ? 0.115 : 0.115))}px;left:0;width:100%;text-align:center;z-index:5;"><span style="display:inline-block;border:1px solid ${gold};color:${gold};border-radius:999px;font-weight:700;font-size:${Math.round(27 * u)}px;padding:${Math.round(6 * u)}px ${Math.round(28 * u)}px;">${esc(o.badge)}</span></div>` : ""}
  ${o.coverSrc ? `
  <div style="position:absolute;top:${Math.round(H * coverTopF)}px;left:${Math.round((W - coverW) / 2)}px;width:${coverW}px;z-index:4;">
    <img src="${o.coverSrc}" style="width:100%;border:1px solid rgba(217,164,65,.75);box-shadow:0 0 ${Math.round(90 * u)}px rgba(217,164,65,.28),0 ${Math.round(30 * u)}px ${Math.round(60 * u)}px rgba(0,0,0,.6);" />
  </div>` : ""}
  <div style="position:absolute;top:${Math.round(H * titleTopF)}px;left:0;width:100%;text-align:center;z-index:5;padding:0 ${Math.round(W * 0.1)}px;box-sizing:border-box;">
    <div style="color:#f5ecd7;font-weight:900;font-size:${Math.round((link ? 44 : 52) * u)}px;line-height:1.5;">${esc(o.title)}</div>
    <div style="width:${Math.round(140 * u)}px;height:1px;background:${gold};margin:${Math.round(16 * u)}px auto;"></div>
    <div style="color:rgba(245,236,215,.85);font-weight:400;font-size:${Math.round((link ? 28 : 32) * u)}px;line-height:1.7;">${esc(l1)} ${esc(l2 === o.title ? "" : l2)}</div>
  </div>
  <div style="position:absolute;bottom:${Math.round(H * (story ? 0.045 : 0.055))}px;left:0;width:100%;text-align:center;z-index:5;">
    <span style="color:${gold};font-weight:700;font-size:${Math.round(26 * u)}px;">متجر نهضة مصر</span>
    <span style="color:${gold};font-size:${Math.round(26 * u)}px;"> — </span>
    <span dir="ltr" style="display:inline-block;color:${gold};font-weight:700;font-size:${Math.round(24 * u)}px;">nahdetmisrbookstore.com</span>
  </div>`;
}

// ---------------------------------------------------------------------------
// CANVA TEMPLATE LAYOUTS — premium background artwork generated once in Canva
// and hosted in the app's own storage (marketing/templates/{key}.jpg,
// 1080×1920, cover-cropped per format). The app composes cover + hook +
// badge + brand footer on top locally: zero Canva calls at design time.
export const CANVA_TEMPLATES = {
  kids: {
    ar: "سماء الليل (أطفال) — Canva", en: "Night sky (kids) — Canva",
    accent: "#f4c95d", line2: "#ffd98a", genres: ["kids"],
  },
  spiritual: {
    ar: "نور روحاني (إيمانيات) — Canva", en: "Heavenly light (faith) — Canva",
    accent: "#e8d5a8", line2: "#f5e6bd", genres: ["religion"],
  },
  modernblue: {
    ar: "أزرق عصري (تطوير وروايات) — Canva", en: "Modern blue (self-dev) — Canva",
    accent: "#8fdcff", line2: "#bfeaff", genres: ["selfdev", "novel"],
  },
  luxury: {
    ar: "فاخر مزخرف (هدايا) — Canva", en: "Ornate luxury (gifts) — Canva",
    accent: "#8a6a1f", line2: "#6d5418", genres: ["history", "general"],
  },
};
// storage file key for each template ("modernblue" reuses modern.jpg)
const TPL_FILE = { kids: "kids", spiritual: "spiritual", modernblue: "modern", luxury: "luxury" };
export function canvaTemplateUrl(supaBase, key) {
  return `${supaBase}/storage/v1/object/public/flipbooks/marketing/templates/${TPL_FILE[key] || key}.jpg`;
}

function canvaTplHtml(tplKey, fmt, W, H, o) {
  const u = Math.min(W, H) / 1080;
  const t = CANVA_TEMPLATES[tplKey] || CANVA_TEMPLATES.kids;
  // luxury is a LIGHT backdrop — dark text, light footer treatment
  const light = tplKey === "luxury";
  const { l1, l2 } = splitHook(o.hook, o.title);
  const link = fmt === "link";
  const story = fmt === "story";
  const hookTop = Math.round(H * (story ? 0.13 : link ? 0.12 : 0.14));
  const coverTop = Math.round(H * (story ? 0.32 : link ? 0.28 : 0.33));
  const coverZone = H * (story ? 0.5 : link ? 0.5 : 0.46) - 90 * u;
  const coverW = Math.round(Math.min(W * (link ? 0.21 : 0.44), coverZone * 0.72));
  const p = o.palette;

  return `
  <div style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;">
    <img src="${o.tplUrl}" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);${W / H > 1080 / 1920 ? "width:100%;height:auto;" : "height:100%;width:auto;"}min-width:100%;min-height:100%;" />
  </div>
  ${light ? "" : `<div style="position:absolute;bottom:0;left:0;width:100%;height:${Math.round(H * 0.22)}px;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(4,6,16,.55) 100%);"></div>`}
  ${orderPill(u, p, Math.round(H * 0.032))}
  ${ribbonHtml(o.badge, u, p)}
  <div style="position:absolute;top:${hookTop}px;left:0;width:100%;text-align:center;z-index:5;padding:0 ${Math.round(W * 0.08)}px;box-sizing:border-box;">
    <div style="color:${light ? "#2b3990" : "#ffffff"};font-weight:700;font-size:${Math.round((link ? 42 : 50) * u)}px;line-height:1.55;${light ? "" : "text-shadow:0 4px 18px rgba(0,0,0,.55);"}">${esc(l1)}</div>
    <div style="color:${light ? t.line2 : t.accent};font-weight:900;font-size:${Math.round((link ? 54 : 64) * u)}px;line-height:1.45;${light ? "" : "text-shadow:0 6px 22px rgba(0,0,0,.55);"}">${esc(l2 || o.title)}</div>
  </div>
  ${o.coverSrc ? `
  <div style="position:absolute;top:${coverTop}px;left:${Math.round((W - coverW) / 2)}px;width:${coverW}px;z-index:4;">
    <img src="${o.coverSrc}" style="width:100%;border-radius:${Math.round(10 * u)}px;border:2px solid rgba(255,255,255,.35);box-shadow:0 ${Math.round(34 * u)}px ${Math.round(64 * u)}px rgba(0,0,0,${light ? ".35" : ".55"});" />
  </div>` : ""}
  ${footerBar(u, p, W, H, light ? "rgba(43,57,144,.8)" : undefined)}`;
}

export const HTML_BANNER_LAYOUTS = ["promo", "modern", "elegant", "tpl-kids", "tpl-spiritual", "tpl-modernblue", "tpl-luxury"];

// Returns the full inner HTML for a hidden host element of size W×H.
// opts: { coverSrc, blurredBg, title, hook, cta, badge, palette, fontFamily }
export function bannerHtml(layout, fmt, W, H, opts) {
  const inner =
    String(layout).startsWith("tpl-") ? canvaTplHtml(String(layout).slice(4), fmt, W, H, opts)
    : layout === "modern" ? modernHtml(fmt, W, H, opts)
    : layout === "elegant" ? elegantHtml(fmt, W, H, opts)
    : promoHtml(fmt, W, H, opts);
  return `<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#0b0e1e;direction:rtl;font-family:${opts.fontFamily || "Cairo, sans-serif"};">${inner}</div>`;
}
