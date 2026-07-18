// Minimal HTML sanitizer for chat messages and notifications.
// Only formatting produced by the message composer survives; everything else
// (scripts, styles, event handlers, unknown tags) is stripped.

const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "S", "BR", "P", "DIV", "UL", "OL", "LI", "A", "SPAN"]);

export function sanitizeHtml(html: string): string {
  if (typeof window === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      walk(child);
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        if (child.tagName === "A" && attr.name === "href" && /^https?:\/\//i.test(attr.value)) continue;
        child.removeAttribute(attr.name);
      }
      if (child.tagName === "A") {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/** plain-text preview of a rich message, for conversation lists */
export function htmlToText(html: string, max = 80): string {
  if (typeof window === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const text = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export const EMOJI = [
  "😀", "😄", "😂", "🤣", "😊", "😍", "😘", "😎", "🤩", "🥳",
  "🙂", "😉", "😇", "🤗", "🤔", "😅", "😌", "😴", "😢", "😭",
  "😤", "😠", "🙄", "😬", "🤯", "😱", "🥺", "😷", "🤒", "🤝",
  "👍", "👎", "👏", "🙏", "💪", "✌️", "👌", "🤞", "👋", "🫡",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💔", "❣️", "💯",
  "🔥", "⭐", "✨", "🎉", "🎊", "🏆", "🥇", "📚", "📖", "✅",
  "❌", "⚠️", "❓", "❗", "💡", "📌", "📦", "🚚", "💰", "📈",
  "📉", "🛒", "🎁", "☕", "🌹", "🌞", "🌙", "⏰", "📞", "✍️",
];
