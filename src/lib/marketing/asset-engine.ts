// Brand Asset Engine — composes Meta-ready post designs on a canvas from the
// real book cover + the AI hook, in Nahdet Misr CI (navy #2b3990 / teal
// #4e7f76, Cairo font). Client-side only.

export type AssetFmt = "sq" | "story" | "link";
export type AssetStyle = "navy" | "paper" | "teal";

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
};

export interface AssetInput {
  cover: HTMLImageElement | null;
  title: string;
  hook: string;
  cta: string;       // e.g. «اطلبه الآن من متجر نهضة مصر»
  style: AssetStyle;
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

export async function renderAsset(fmt: AssetFmt, input: AssetInput): Promise<Blob> {
  await ensureFonts();
  const [W, H] = ASSET_DIMS[fmt];
  const p = PALETTES[input.style];
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  paintBackground(ctx, W, H, p);

  ctx.textAlign = "center";
  ctx.direction = "rtl";

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
    // accent divider
    ctx.fillStyle = p.accent;
    const divY = textTop + titleLines * W * 0.078 - W * 0.03;
    ctx.fillRect(W / 2 - W * 0.07, divY, W * 0.14, 6);
    ctx.fillStyle = p.sub;
    ctx.font = `400 ${Math.round(W * 0.041)}px Cairo, sans-serif`;
    wrapText(ctx, input.hook, W / 2, divY + W * 0.075, W * 0.84, W * 0.058, fmt === "story" ? 6 : 4);
    paintFooter(ctx, W, H, p, input.cta, footerH);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.92);
  });
}
