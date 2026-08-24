// Client-side PDF parsing for the Marketing Studio — text from the first pages
// plus a first-page render as the cover. Uses the same pdf.js build Book Studio
// already loads (CDN, cached by the browser), so no bundle weight is added.
// Browser only.

export interface ParsedPdf {
  title: string;
  text: string;
  coverBlob: Blob | null;
}

const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

interface PdfTextItem { str?: string }
interface PdfPage {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void> };
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  getMetadata(): Promise<{ info?: { Title?: string } }>;
}
interface PdfJsLib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(o: { data: ArrayBuffer }): { promise: Promise<PdfDoc> };
}

declare global {
  interface Window {
    pdfjsLib?: PdfJsLib;
  }
}

let loading: Promise<PdfJsLib> | null = null;

function loadPdfJs(): Promise<PdfJsLib> {
  if (typeof window === "undefined") return Promise.reject(new Error("browser only"));
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!loading) {
    loading = new Promise<PdfJsLib>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PDFJS_URL;
      s.onload = () => {
        if (!window.pdfjsLib) {
          reject(new Error("PDF engine failed to initialise"));
          return;
        }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
        resolve(window.pdfjsLib);
      };
      s.onerror = () => {
        loading = null; // a later attempt may succeed once the network is back
        reject(new Error("could not load the PDF engine — check the internet connection"));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

export async function parsePdf(file: File, textCap = 150000): Promise<ParsedPdf> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;

  // Text, page by page until the cap. Scanned PDFs have no text layer and
  // simply yield an empty string — the caller decides how to warn.
  let text = "";
  for (let p = 1; p <= doc.numPages && text.length < textCap; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const chunk = tc.items
      .map((it) => it.str ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (chunk) text += chunk + "\n\n";
  }
  text = text.slice(0, textCap).trim();

  // Cover: render page 1 at up to ~900px wide.
  let coverBlob: Blob | null = null;
  try {
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 900 / Math.max(1, vp.width));
    const v2 = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(v2.width));
    c.height = Math.max(1, Math.round(v2.height));
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: v2 }).promise;
    coverBlob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
  } catch {
    coverBlob = null;
  }

  const meta = await doc.getMetadata().catch(() => null);
  const title = meta?.info?.Title?.trim() || file.name.replace(/\.pdf$/i, "");
  return { title, text, coverBlob };
}
