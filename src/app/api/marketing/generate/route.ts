import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getApiUser } from "@/lib/supabase/api-auth";
import { getMarketingConfig } from "@/lib/marketing/config";
import { builtinGenerate } from "@/lib/marketing/builtin-generator";

export const maxDuration = 120;

// POST { flipbookId?, text?, title, buyUrl?, instructions?, research?, lang,
//        engine?: "builtin" | "claude", variant? }
// -> { summary, hook, post_fb, post_ig, hashtags, research_notes, engine }
//
// Two engines:
//  - "builtin" (free, zero integrations): extractive summary + genre-aware
//    Arabic template library. Default when no Anthropic key is configured.
//  - "claude": summarizes the book with Claude and writes channel-ready copy;
//    with research=true it first runs Anthropic server-side web searches for
//    current best practices / trends. Falls back to builtin if no key.
export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.slice(0, 300) : "";
  const flipbookId = typeof body.flipbookId === "string" ? body.flipbookId : null;
  const instructions = typeof body.instructions === "string" ? body.instructions.slice(0, 2000) : "";
  const buyUrl = typeof body.buyUrl === "string" ? body.buyUrl.slice(0, 500) : "";
  const research = body.research === true;
  const lang = body.lang === "en" ? "en" : "ar";

  let text = typeof body.text === "string" ? body.text : "";
  if (!text && flipbookId) {
    const { data } = await user.supabase
      .from("flipbook_texts")
      .select("txt")
      .eq("path", `${flipbookId}.json`)
      .maybeSingle();
    text = data?.txt ?? "";
  }
  if (!text && !title) return NextResponse.json({ error: "no book text or title provided" }, { status: 400 });
  text = text.slice(0, 40000); // keep the prompt (and cost) bounded

  const config = await getMarketingConfig(user);
  const wantsClaude = body.engine === "claude";
  const useBuiltin = body.engine === "builtin" || !config.aiKey;

  if (useBuiltin) {
    const result = builtinGenerate({
      title,
      text,
      buyUrl: buyUrl || undefined,
      lang,
      variant: Math.abs(Math.floor(Number(body.variant) || 0)),
    });
    return NextResponse.json({
      ...result,
      engine: "builtin",
      // If the user explicitly asked for Claude but no key is saved, say so.
      notice: wantsClaude && !config.aiKey
        ? "No Anthropic key configured — used the free built-in generator instead."
        : undefined,
    });
  }

  const langName = lang === "en" ? "English" : "Egyptian-flavored Modern Standard Arabic";
  const system = `You are the social media marketing engine of «متجر نهضة مصر» (Nahdet Misr bookstore, Egypt).
You are given the text of a book. Your job:
1. Summarize what the book is about (3-5 sentences, for internal use).
2. Write a short attention hook (max 12 words) that would stop the scroll.
3. Write a Facebook post and an Instagram caption that market this book. Primary language: ${langName}. Make them attractive, emotional and specific to THIS book's content (quote a striking idea or moment from it). Facebook: 3-6 short paragraphs with line breaks + emojis + a clear call to action${buyUrl ? ` linking to ${buyUrl}` : " to order from the store"}. Instagram: tighter, hook first, line breaks, CTA "الرابط في البايو" style${buyUrl ? "" : ""}.
4. Provide 8-12 hashtags mixing Arabic + English book/reading tags relevant to this genre.
${research ? "5. FIRST use web search (2-3 searches max) to check current best practices for book marketing posts on Facebook/Instagram and any trends about this book/author/genre, then apply what you learn. Put what you learned in research_notes (2-4 bullet points)." : ""}
Never invent facts about the book that are not supported by its text. Do not mention that you are an AI.
Return ONLY a JSON object, no markdown fences, with exactly these keys:
{"summary": "...", "hook": "...", "post_fb": "...", "post_ig": "...", "hashtags": "#tag1 #tag2 ...", "research_notes": "..."}`;

  const client = new Anthropic({ apiKey: config.aiKey });
  try {
    const response = await client.messages.create({
      model: config.aiModel,
      max_tokens: 8000,
      output_config: { effort: "medium" },
      system,
      tools: research
        ? [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 3 }]
        : undefined,
      messages: [
        {
          role: "user",
          content: `Book title: ${title || "(unknown)"}\n${instructions ? `Extra instructions from the marketer: ${instructions}\n` : ""}\nBook text:\n${text || "(no text available — market based on the title)"}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "The AI declined this request." }, { status: 502 });
    }

    // Take the last text block (with web search the answer follows tool results).
    let raw = "";
    for (const block of response.content) {
      if (block.type === "text") raw = block.text;
    }
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("model returned no JSON");
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, string>;

    return NextResponse.json({
      summary: parsed.summary ?? "",
      hook: parsed.hook ?? "",
      post_fb: parsed.post_fb ?? "",
      post_ig: parsed.post_ig ?? "",
      hashtags: parsed.hashtags ?? "",
      research_notes: parsed.research_notes ?? "",
      engine: "claude",
      model: response.model,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "generation failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
