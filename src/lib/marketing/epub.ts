// Client-side EPUB parsing for the Marketing Studio — a lightweight version of
// what Book Studio does: unzip, walk the OPF spine for text, find the cover.
// Runs in the browser only (uses DOMParser).
import JSZip from "jszip";

export interface ParsedEpub {
  title: string;
  text: string;
  coverBlob: Blob | null;
}

function dirOf(p: string) {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i + 1);
}

// EPUB hrefs are relative to the OPF and may be URL-encoded or contain ../
function resolveHref(base: string, href: string) {
  const raw = decodeURIComponent(href.split("#")[0]);
  const parts = (base + raw).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return out.join("/");
}

export async function parseEpub(file: File, textCap = 150000): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(file);
  const container = await zip.file("META-INF/container.xml")?.async("string");
  if (!container) throw new Error("Not a valid EPUB (no container.xml)");
  const opfPath = container.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new Error("Not a valid EPUB (no OPF path)");
  const opfDir = dirOf(opfPath);
  const opfXml = await zip.file(opfPath)?.async("string");
  if (!opfXml) throw new Error("Not a valid EPUB (missing OPF)");

  const dom = new DOMParser();
  const opf = dom.parseFromString(opfXml, "application/xml");

  const title =
    opf.getElementsByTagNameNS("*", "title")[0]?.textContent?.trim() ||
    file.name.replace(/\.epub$/i, "");

  // manifest: id -> {href, mediaType, properties}
  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>();
  for (const item of Array.from(opf.getElementsByTagNameNS("*", "item"))) {
    const id = item.getAttribute("id");
    if (!id) continue;
    manifest.set(id, {
      href: item.getAttribute("href") ?? "",
      mediaType: item.getAttribute("media-type") ?? "",
      properties: item.getAttribute("properties") ?? "",
    });
  }

  // Text: spine order, tags stripped.
  let text = "";
  const spine = Array.from(opf.getElementsByTagNameNS("*", "itemref"));
  for (const ref of spine) {
    if (text.length >= textCap) break;
    const item = manifest.get(ref.getAttribute("idref") ?? "");
    if (!item || !/html|xml/i.test(item.mediaType)) continue;
    const html = await zip.file(resolveHref(opfDir, item.href))?.async("string");
    if (!html) continue;
    const doc = dom.parseFromString(html, "text/html");
    const chunk = (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
    if (chunk) text += chunk + "\n\n";
  }
  text = text.slice(0, textCap).trim();

  // Cover: properties="cover-image", else <meta name="cover" content="{id}">,
  // else first image in the manifest.
  let coverItem: { href: string } | undefined;
  for (const item of manifest.values()) {
    if (/cover-image/.test(item.properties)) { coverItem = item; break; }
  }
  if (!coverItem) {
    const metaCover = Array.from(opf.getElementsByTagNameNS("*", "meta")).find(
      (m) => m.getAttribute("name") === "cover"
    )?.getAttribute("content");
    if (metaCover && manifest.has(metaCover)) coverItem = manifest.get(metaCover);
  }
  if (!coverItem) {
    for (const item of manifest.values()) {
      if (/^image\//.test(item.mediaType)) { coverItem = item; break; }
    }
  }
  let coverBlob: Blob | null = null;
  if (coverItem) {
    coverBlob = (await zip.file(resolveHref(opfDir, coverItem.href))?.async("blob")) ?? null;
  }

  return { title, text, coverBlob };
}
