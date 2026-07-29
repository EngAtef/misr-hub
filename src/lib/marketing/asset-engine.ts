// Brand Asset Engine — composes Meta-ready post designs on a canvas from the
// real book cover + the AI hook, in Nahdet Misr CI (navy #2b3990 / teal
// #4e7f76, Cairo font). Client-side only.

export type AssetFmt = "sq" | "story" | "link";
export type AssetStyle = "navy" | "paper" | "teal" | "night" | "sand" | "rose" | "fresh";
export type AssetLayout = "classic" | "coverfull" | "quote" | "split" | "minimal";

export const ASSET_DIMS: Record<AssetFmt, [number, number]> = {
  sq: [1080, 1080],      // FB/IG feed square
  story: [1080, 1920],   // IG story / reel cover
  link: [1200, 628],     // FB link/ad landscape
};

export const ASSET_LABELS: Record<AssetFmt, { ar: string; en: string }> = {
  sq: { ar: "مربع 1080", en: "Square 1080" },
  story: { ar: "ستوري 1080×1920", en: "Story 1080×1920" },
  link: { ar: "عرضي 1200×628", en: "Landscape 1200×628" },
};

interface Palette { bg1: string; bg2: string; text: string; sub: string; accent: string; footer: string; footerText: string }
const PALETTES: Record<AssetStyle, Palette> = {
  navy:  { bg1: "#2b3990", bg2: "#1a2258", text: "#ffffff", sub: "#c7cdf0", accent: "#7fc7bb", footer: "#141a44", footerText: "#ffffff" },
  paper: { bg1: "#faf7f0", bg2: "#efe9db", text: "#2b3990", sub: "#4a4f66", accent: "#4e7f76", footer: "#2b3990", footerText: "#ffffff" },
  teal:  { bg1: "#4e7f76", bg2: "#32544e", text: "#ffffff", sub: "#d7e7e3", accent: "#f4c95d", footer: "#243d38", footerText: "#ffffff" },
  night: { bg1: "#101322", bg2: "#05060d", text: "#f5e9c9", sub: "#b8b39f", accent: "#d9a441", footer: "#000000", footerText: "#f5e9c9" },
  sand:  { bg1: "#f3e5cf", bg2: "#e2cba4", text: "#4a3418", sub: "#7a6444", accent: "#b0722a", footer: "#4a3418", footerText: "#f9f1e2" },
  rose:  { bg1: "#f9e8ee", bg2: "#f0cfdc", text: "#5c2340", sub: "#8f5a74", accent: "#c9426f", footer: "#5c2340", footerText: "#fdf3f7" },
  fresh: { bg1: "#ffffff", bg2: "#eef4ff", text: "#16233f", sub: "#5a6a86", accent: "#2f7df6", footer: "#16233f", footerText: "#ffffff" },
};

export const STYLE_NAMES: Record<AssetStyle, { ar: string; en: string }> = {
  navy:  { ar: "كحلي (الهوية)", en: "Navy (brand)" },
  paper: { ar: "ورقي فاتح", en: "Paper light" },
  teal:  { ar: "أخضر مائي", en: "Teal" },
  night: { ar: "ليلي ذهبي", en: "Night gold" },
  sand:  { ar: "رملي دافئ", en: "Warm sand" },
  rose:  { ar: "وردي (روايات)", en: "Rose (novels)" },
  fresh: { ar: "أبيض عصري", en: "Fresh white" },
};

export const LAYOUT_NAMES: Record<AssetLayout, { ar: string; en: string }> = {
  classic:   { ar: "كلاسيكي", en: "Classic" },
  coverfull: { ar: "غلاف كامل", en: "Full cover" },
  quote:     { ar: "بطاقة اقتباس", en: "Quote card" },
  split:     { ar: "مقسوم نصين", en: "Split" },
  minimal:   { ar: "بسيط أنيق", en: "Minimal" },
};

export interface AssetInput {
  cover: HTMLImageElement | null;
  title: string;
  hook: string;
  cta: string;       // e.g. «اطلبه الآن من متجر نهضة مصر»
  style: AssetStyle;
  layout?: AssetLayout; // defaults to "classic"
}

export async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // Supabase storage sends ACAO:* — keeps the canvas clean
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

async function ensureFonts() {
  try {
    await Promise.all([
      document.fonts.load('700 60px "Cairo"'),
      document.fonts.load('900 60px "Cairo"'),
      document.fonts.load('400 40px "Cairo"'),
    ]);
  } catch {
    // font API unavailable — canvas falls back to system fonts
  }
}

// RTL-aware word wrap; returns the lines actually drawn.
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
): number {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else {
      line = test;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (lines.length === maxLines && line) lines[maxLines - 1] += "…";
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return lines.length;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, maxW: number, maxH: number) {
  const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  roundRect(ctx, x, y, w, h, 14);
  ctx.clip();
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
  // thin frame
  ctx.save();
  roundRect(ctx, x, y, w, h, 14);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
  return { x, y, w, h };
}

function paintBackground(ctx: CanvasRenderingContext2D, W: number, H: number, p: Palette) {
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, p.bg1);
  g.addColorStop(1, p.bg2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // decorative accent circles
  ctx.save();
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = p.accent;
  ctx.beginPath(); ctx.arc(W * 0.92, H * 0.06, W * 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(W * 0.04, H * 0.95, W * 0.18, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function paintFooter(ctx: CanvasRenderingContext2D, W: number, H: number, p: Palette, cta: string, footerH: number) {
  ctx.fillStyle = p.footer;
  ctx.fillRect(0, H - footerH, W, footerH);
  ctx.fillStyle = p.footerText;
  ctx.textAlign = "center";
  ctx.direction = "rtl";
  ctx.font = `700 ${Math.round(footerH * 0.34)}px Cairo, sans-serif`;
  ctx.fillText("متجر نهضة مصر", W / 2, H - footerH * 0.58);
  ctx.font = `400 ${Math.round(footerH * 0.24)}px Cairo, sans-serif`;
  ctx.fillStyle = p.accent;
  ctx.fillText(cta, W / 2, H - footerH * 0.2, W * 0.9);
}

// Cover-crop fill: draws the image covering the whole target rect.
function drawCoverFill(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function layoutClassic(ctx: CanvasRenderingContext2D, fmt: AssetFmt, W: number, H: number, p: Palette, input: AssetInput) {
  paintBackground(ctx, W, H, p);
  if (fmt === "link") {
    // Landscape: cover on the left, text on the right (RTL reads right first).
    const footerH = Math.round(H * 0.14);
    if (input.cover) drawCover(ctx, input.cover, W * 0.22, (H - footerH) / 2, W * 0.32, (H - footerH) * 0.82);
    const tx = W * 0.66;
    const maxW = W * 0.56;
    ctx.fillStyle = p.text;
    ctx.font = `900 ${Math.round(H * 0.085)}px Cairo, sans-serif`;
    const titleLines = wrapText(ctx, input.title, tx, H * 0.24, maxW, H * 0.105, 2);
    ctx.fillStyle = p.sub;
    ctx.font = `400 ${Math.round(H * 0.052)}px Cairo, sans-serif`;
    wrapText(ctx, input.hook, tx, H * 0.24 + titleLines * H * 0.105 + H * 0.03, maxW, H * 0.072, 4);
    paintFooter(ctx, W, H, p, input.cta, footerH);
  } else {
    // Portrait/square: cover on top, title + hook below, brand footer.
    const footerH = Math.round(H * (fmt === "story" ? 0.09 : 0.12));
    const coverMaxH = H * (fmt === "story" ? 0.42 : 0.46);
    const coverCy = H * (fmt === "story" ? 0.27 : 0.3);
    if (input.cover) drawCover(ctx, input.cover, W / 2, coverCy, W * 0.62, coverMaxH);
    const textTop = coverCy + coverMaxH / 2 + H * (fmt === "story" ? 0.06 : 0.07);
    ctx.fillStyle = p.text;
    ctx.font = `900 ${Math.round(W * 0.062)}px Cairo, sans-serif`;
    const titleLines = wrapText(ctx, input.title, W / 2, textTop, W * 0.86, W * 0.078, 2);
    ctx.fillStyle = p.accent;
    const divY = textTop + titleLines * W * 0.078 - W * 0.03;
    ctx.fillRect(W / 2 - W * 0.07, divY, W * 0.14, 6);
    ctx.fillStyle = p.sub;
    ctx.font = `400 ${Math.round(W * 0.041)}px Cairo, sans-serif`;
    wrapText(ctx, input.hook, W / 2, divY + W * 0.075, W * 0.84, W * 0.058, fmt === "story" ? 6 : 4);
    paintFooter(ctx, W, H, p, input.cta, footerH);
  }
}

// Full-bleed cover with a bottom gradient overlay carrying the text.
function layoutCoverFull(ctx: CanvasRenderingContext2D, fmt: AssetFmt, W: number, H: number, p: Palette, input: AssetInput) {
  if (input.cover) {
    // Blurred backdrop kills letterbox bands on mismatched aspect ratios.
    ctx.save();
    ctx.filter = "blur(40px)";
    drawCoverFill(ctx, input.cover, -40, -40, W + 80, H + 80);
    ctx.restore();
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, 0, W, H);
    const cw = fmt === "link" ? W * 0.3 : W * 0.66;
    const chMax = fmt === "link" ? H * 0.72 : H * 0.5;
    drawCover(ctx, input.cover, fmt === "link" ? W * 0.22 : W / 2, fmt === "link" ? H * 0.44 : H * 0.32, cw, chMax);
  } else {
    paintBackground(ctx, W, H, p);
  }
  // gradient text panel
  const panelTop = fmt === "link" ? 0 : H * 0.58;
  const g = ctx.createLinearGradient(0, panelTop, 0, H);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.35, "rgba(0,0,0,0.72)");
  g.addColorStop(1, "rgba(0,0,0,0.9)");
  ctx.fillStyle = g;
  ctx.fillRect(0, panelTop, W, H - panelTop);

  const tx = fmt === "link" ? W * 0.66 : W / 2;
  const maxW = fmt === "link" ? W * 0.56 : W * 0.86;
  const base = fmt === "link" ? H * 0.36 : H * 0.76;
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = `900 ${Math.round((fmt === "link" ? H : W) * (fmt === "link" ? 0.085 : 0.06))}px Cairo, sans-serif`;
  const tl = wrapText(ctx, input.title, tx, base, maxW, (fmt === "link" ? H : W) * 0.075, 2);
  ctx.fillStyle = p.accent;
  ctx.font = `700 ${Math.round((fmt === "link" ? H : W) * 0.04)}px Cairo, sans-serif`;
  wrapText(ctx, input.hook, tx, base + tl * (fmt === "link" ? H : W) * 0.075 + 10, maxW, (fmt === "link" ? H : W) * 0.055, 3);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `700 ${Math.round((fmt === "link" ? H : W) * 0.03)}px Cairo, sans-serif`;
  ctx.fillText(`متجر نهضة مصر  •  ${input.cta}`, W / 2, H - (fmt === "story" ? H * 0.03 : H * 0.045), W * 0.92);
}

// Big-quote card: the hook as the hero, small cover as a signature.
function layoutQuote(ctx: CanvasRenderingContext2D, fmt: AssetFmt, W: number, H: number, p: Palette, input: AssetInput) {
  paintBackground(ctx, W, H, p);
  // giant decorative quote mark
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = p.accent;
  ctx.font = `900 ${Math.round(W * 0.4)}px Georgia, serif`;
  ctx.textAlign = "left";
  ctx.fillText("”", W * 0.04, H * (fmt === "story" ? 0.18 : 0.3));
  ctx.restore();

  ctx.textAlign = "center";
  const cy = H * (fmt === "story" ? 0.4 : 0.42);
  ctx.fillStyle = p.text;
  ctx.font = `700 ${Math.round(W * (fmt === "link" ? 0.045 : 0.055))}px Cairo, sans-serif`;
  const lines = wrapText(ctx, `«${input.hook}»`, W / 2, cy - H * 0.08, W * 0.8, W * (fmt === "link" ? 0.062 : 0.075), fmt === "story" ? 7 : 5);
  const below = cy - H * 0.08 + lines * W * (fmt === "link" ? 0.062 : 0.075);
  ctx.fillStyle = p.accent;
  ctx.fillRect(W / 2 - W * 0.05, below + H * 0.012, W * 0.1, 5);
  ctx.fillStyle = p.sub;
  ctx.font = `700 ${Math.round(W * 0.032)}px Cairo, sans-serif`;
  ctx.fillText(`— ${input.title}`, W / 2, below + H * 0.06, W * 0.85);
  if (input.cover) {
    drawCover(ctx, input.cover, W / 2, H * (fmt === "story" ? 0.78 : 0.78), W * 0.2, H * (fmt === "story" ? 0.16 : 0.2));
  }
  paintFooter(ctx, W, H, p, input.cta, Math.round(H * (fmt === "story" ? 0.07 : 0.09)));
}

// Half cover (full-bleed) / half color panel with the text.
function layoutSplit(ctx: CanvasRenderingContext2D, fmt: AssetFmt, W: number, H: number, p: Palette, input: AssetInput) {
  paintBackground(ctx, W, H, p);
  const vertical = fmt !== "link"; // sq/story: top half image; link: side split
  if (input.cover) {
    if (vertical) drawCoverFill(ctx, input.cover, 0, 0, W, H * 0.52);
    else drawCoverFill(ctx, input.cover, 0, 0, W * 0.46, H);
  }
  // accent seam
  ctx.fillStyle = p.accent;
  if (vertical) ctx.fillRect(0, H * 0.52 - 4, W, 8);
  else ctx.fillRect(W * 0.46 - 4, 0, 8, H);

  const tx = vertical ? W / 2 : W * 0.72;
  const maxW = vertical ? W * 0.84 : W * 0.44;
  const top = vertical ? H * 0.62 : H * 0.3;
  ctx.textAlign = "center";
  ctx.fillStyle = p.text;
  ctx.font = `900 ${Math.round(W * (vertical ? 0.06 : 0.045))}px Cairo, sans-serif`;
  const tl = wrapText(ctx, input.title, tx, top, maxW, W * (vertical ? 0.075 : 0.058), 2);
  ctx.fillStyle = p.sub;
  ctx.font = `400 ${Math.round(W * (vertical ? 0.038 : 0.03))}px Cairo, sans-serif`;
  wrapText(ctx, input.hook, tx, top + tl * W * (vertical ? 0.075 : 0.058) + H * 0.02, maxW, W * (vertical ? 0.055 : 0.042), fmt === "story" ? 6 : 3);
  paintFooter(ctx, W, H, p, input.cta, Math.round(H * (fmt === "story" ? 0.07 : 0.1)));
}

// Airy minimal: light canvas, small centered cover, thin rules, no footer bar.
function layoutMinimal(ctx: CanvasRenderingContext2D, fmt: AssetFmt, W: number, H: number, p: Palette, input: AssetInput) {
  ctx.fillStyle = p.bg1;
  ctx.fillRect(0, 0, W, H);
  // hairline frame
  ctx.strokeStyle = p.accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(W * 0.045, H * 0.045, W * 0.91, H * 0.91);

  const coverCy = H * (fmt === "story" ? 0.32 : 0.36);
  if (input.cover) drawCover(ctx, input.cover, W / 2, coverCy, W * 0.44, H * (fmt === "story" ? 0.34 : 0.4));
  const top = coverCy + H * (fmt === "story" ? 0.2 : 0.24);
  ctx.textAlign = "center";
  ctx.fillStyle = p.text;
  ctx.font = `700 ${Math.round(W * 0.05)}px Cairo, sans-serif`;
  const tl = wrapText(ctx, input.title, W / 2, top, W * 0.8, W * 0.065, 2);
  ctx.fillStyle = p.sub;
  ctx.font = `400 ${Math.round(W * 0.032)}px Cairo, sans-serif`;
  wrapText(ctx, input.hook, W / 2, top + tl * W * 0.065 + H * 0.015, W * 0.76, W * 0.048, fmt === "story" ? 5 : 3);
  ctx.fillStyle = p.accent;
  ctx.font = `700 ${Math.round(W * 0.028)}px Cairo, sans-serif`;
  ctx.fillText(`متجر نهضة مصر  •  ${input.cta}`, W / 2, H * 0.93, W * 0.84);
}

export async function renderAsset(fmt: AssetFmt, input: AssetInput): Promise<Blob> {
  await ensureFonts();
  const [W, H] = ASSET_DIMS[fmt];
  const p = PALETTES[input.style];
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.textAlign = "center";
  ctx.direction = "rtl";

  const layout = input.layout ?? "classic";
  if (layout === "coverfull") layoutCoverFull(ctx, fmt, W, H, p, input);
  else if (layout === "quote") layoutQuote(ctx, fmt, W, H, p, input);
  else if (layout === "split") layoutSplit(ctx, fmt, W, H, p, input);
  else if (layout === "minimal") layoutMinimal(ctx, fmt, W, H, p, input);
  else layoutClassic(ctx, fmt, W, H, p, input);

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.92);
  });
}
