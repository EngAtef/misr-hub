import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getApiUser } from "@/lib/supabase/api-auth";
import { getMarketingConfig } from "@/lib/marketing/config";
import { builtinGenerate, detectGenreKey, buildCampaignPack } from "@/lib/marketing/builtin-generator";
import { buildMarketingPlan, type MarketingPlan } from "@/lib/marketing/director";
import { occasionHint } from "@/lib/marketing/occasions";

export const maxDuration = 120;

// POST { flipbookId?, flipbookIds?, titles?, text?, title, buyUrl?,
//        instructions?, research?, lang, engine?: "builtin"|"claude", variant? }
// -> { summary, hook, post_fb, post_ig, hashtags, research_notes, engine,
//      plan: MarketingPlan, bundleSuggestions }
//
// Two engines:
//  - "builtin" (free, zero integrations): extractive summary + genre-aware
//    Arabic template library + rule-based marketing-director plan grounded in
//    real store data (top cities). Default when no Anthropic key is set.
//  - "claude": acts as marketing director + media buyer; with research=true it
//    first runs Anthropic server-side web searches. Falls back to builtin.
export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.slice(0, 300) : "";
  const flipbookId = typeof body.flipbookId === "string" ? body.flipbookId : null;
  const flipbookIds: string[] = Array.isArray(body.flipbookIds)
    ? body.flipbookIds.filter((x: unknown) => typeof x === "string").slice(0, 6)
    : flipbookId ? [flipbookId] : [];
  const titles: string[] = Array.isArray(body.titles)
    ? body.titles.filter((x: unknown) => typeof x === "string").map((s: string) => s.slice(0, 200)).slice(0, 6)
    : title ? [title] : [];
  const instructions = typeof body.instructions === "string" ? body.instructions.slice(0, 2000) : "";
  const buyUrl = typeof body.buyUrl === "string" ? body.buyUrl.slice(0, 500) : "";
  const readUrl = typeof body.readUrl === "string" ? body.readUrl.slice(0, 500) : "";
  const research = body.research === true;
  const lang = body.lang === "en" ? "en" : "ar";
  const packMode = body.pack === true;

  let text = typeof body.text === "string" ? body.text : "";
  if (!text && flipbookIds.length) {
    const { data } = await user.supabase
      .from("flipbook_texts")
      .select("path, txt")
      .in("path", flipbookIds.map((id) => `${id}.json`));
    // Cap per-book so one long novel doesn't crowd out the others in a bundle.
    const per = Math.floor(40000 / Math.max(flipbookIds.length, 1));
    text = ((data ?? []) as { path: string; txt: string }[])
      .map((r) => r.txt.slice(0, per))
      .join("\n\n----- كتاب آخر -----\n\n");
  }
  if (!text && !title) return NextResponse.json({ error: "no book text or title provided" }, { status: 400 });
  text = text.slice(0, 40000); // keep the prompt (and cost) bounded

  // 7-day campaign pack — built-in engine only (fast, free).
  if (packMode) {
    const days = buildCampaignPack({ title, text, buyUrl: buyUrl || undefined, readUrl: readUrl || undefined });
    return NextResponse.json({ pack: days, engine: "builtin" });
  }

  // Ground the media plan in real store data: top cities by actual orders
  // (last 90 days), the store's real order-hour peaks, and same-category
  // books to suggest as a bundle.
  let topCities: string[] = [];
  let bundleSuggestions: { id: string; title: string }[] = [];
  let bestHours = "";
  try {
    const from = new Date(Date.now() - 90 * 86400000).toISOString();
    const { data: cities } = await user.supabase.rpc("fn_breakdown", {
      p_dim: "city", p_from: from, p_to: null, p_limit: 4,
    });
    topCities = ((cities ?? []) as { label: string }[]).map((c) => c.label).filter(Boolean);
  } catch { /* plan falls back to defaults */ }
  try {
    const { data: bh } = await user.supabase.rpc("fn_best_post_hours");
    const hours = ((bh as { hours?: { h: number; orders: number }[] })?.hours ?? [])
      .sort((a, b) => b.orders - a.orders).slice(0, 3).map((x) => x.h).sort((a, b) => a - b);
    if (hours.length) {
      // Post ~1h before the order peaks so content is in feeds when buyers act.
      bestHours = `انشر حوالي ${hours.map((h) => `${((h + 23) % 24)}:00`).join(" و ")} — ذروة طلبات متجرك الحقيقية الساعات ${hours.map((h) => `${h}:00`).join("، ")}`;
    }
  } catch { /* schedule falls back to the generic guidance */ }
  try {
    if (flipbookIds.length === 1) {
      // flipbooks is keyed by storage path: {id}.json (v2) or {id}.html (legacy)
      const { data: me } = await user.supabase
        .from("flipbooks").select("category")
        .in("path", [`${flipbookIds[0]}.json`, `${flipbookIds[0]}.html`])
        .limit(1).maybeSingle();
      const cat = (me as { category: string | null } | null)?.category;
      if (cat) {
        const { data: sibs } = await user.supabase
          .from("flipbooks")
          .select("path, title")
          .eq("category", cat)
          .limit(6);
        bundleSuggestions = ((sibs ?? []) as { path: string; title: string }[])
          .map((s) => ({ id: s.path.replace(/\.(json|html)$/, ""), title: s.title }))
          .filter((s) => s.id !== flipbookIds[0])
          .slice(0, 4);
      }
    }
  } catch { /* suggestions are optional */ }

  const config = await getMarketingConfig(user);
  const wantsClaude = body.engine === "claude";
  const useBuiltin = body.engine === "builtin" || !config.aiKey;

  if (useBuiltin) {
    const result = builtinGenerate({
      title,
      text,
      buyUrl: buyUrl || undefined,
      readUrl: readUrl || undefined,
      lang,
      variant: Math.abs(Math.floor(Number(body.variant) || 0)),
      titles,
    });
    const plan = buildMarketingPlan({
      genreKey: result.genre,
      titles: titles.length ? titles : [title],
      topCities,
      buyUrl: buyUrl || undefined,
      bundleTitles: bundleSuggestions.map((b) => b.title),
      bestHours,
      occasion: occasionHint(new Date(), result.genre),
    });
    return NextResponse.json({
      ...result,
      plan,
      bundleSuggestions,
      engine: "builtin",
      // If the user explicitly asked for Claude but no key is saved, say so.
      notice: wantsClaude && !config.aiKey
        ? "No Anthropic key configured — used the free built-in generator instead."
        : undefined,
    });
  }

  const langName = lang === "en" ? "English" : "Egyptian-flavored Modern Standard Arabic";
  const multiNote = titles.length > 1
    ? `This is a MULTI-BOOK bundle post for ${titles.length} books: ${titles.map((tt) => `«${tt}»`).join(", ")}. Write the posts as a curated reading-list/bundle.`
    : "";
  const system = `You are the MARKETING DIRECTOR and senior MEDIA BUYER of «متجر نهضة مصر» (Nahdet Misr bookstore, Egypt). You are given the text of a book (or several books). Produce both the creative AND the full media plan, like an agency deliverable.
${multiNote}
1. Summarize what the book is about (3-5 sentences, for internal use).
2. Write a short attention hook (max 12 words) that would stop the scroll.
3. Write a Facebook post, an Instagram caption, and a WhatsApp broadcast message. Primary language: ${langName}. Attractive, emotional, specific to THIS book's content (quote a striking idea or moment from it). Facebook: 3-6 short paragraphs + emojis + clear CTA${buyUrl ? ` linking to ${buyUrl}` : " to order from the store"}. Instagram: tighter, hook first, CTA "الرابط في البايو" style. WhatsApp: short, *bold* markers, direct link, ends with a reply hook (رد بكلمة "طلب").${readUrl ? `\nA free-first-chapter reader link exists: ${readUrl} — include it as a "اقرأ أول فصل مجانًا" line in the Facebook and WhatsApp posts.` : ""}
4. Provide 8-12 hashtags mixing Arabic + English tags relevant to this genre.
5. As marketing director, define the buyer persona for THIS specific book (who exactly buys it in Egypt: age, gender skew, life situation, pains, motivations).
6. Decide: should this be published as a paid ad, organic only, or both? Give the reasoning a director would give.
7. As media buyer, write the COMPLETE ad configuration per platform (Meta campaign + organic boost${titles.length > 1 ? " + carousel notes for the bundle" : ""}, and TikTok if this genre fits): campaign objective, exact age range, gender, geo (Egypt — prioritize these real top cities by actual store orders: ${topCities.join(", ") || "Cairo, Giza, Alexandria"}), Meta interest targeting names, placements, daily budget in EGP with kill/scale rules, test duration, creative guidance, CTA button, schedule, and 2-4 pro tips each.
8. Recommend retargeting audiences (the store app can export: abandoned-cart Meta Custom Audience, and a lookalike seed of 3+ order customers) and 3-4 A/B tests.
${research ? "9. FIRST use web search (2-3 searches max) for current Meta/TikTok book-marketing best practices and any trends about this book/author/genre, then apply. Put learnings in research_notes (2-4 bullets)." : ""}
Never invent facts about the book not supported by its text. Do not mention you are an AI. All plan text in ${langName}.
Return ONLY a JSON object, no markdown fences, with exactly these keys:
{"summary": "...", "hook": "...", "post_fb": "...", "post_ig": "...", "post_wa": "...", "hashtags": "#tag1 #tag2 ...", "research_notes": "...",
 "plan": {"persona": {"name": "...", "age": "...", "gender": "...", "description": "...", "pains": ["..."], "motivations": ["..."]},
  "decision": {"mode": "ad"|"organic"|"both", "reason": "..."},
  "platforms": [{"platform": "...", "objective": "...", "age": "...", "gender": "...", "geo": "...", "interests": ["..."], "placements": "...", "budget": "...", "duration": "...", "creative": "...", "cta": "...", "schedule": "...", "tips": ["..."]}],
  "retargeting": ["..."], "abTests": ["..."], "multiBook": "..."}}`;

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
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;

    // If the model skipped/garbled the plan, fall back to the rule-based one
    // so the page always has a full director's plan to show.
    let plan = parsed.plan as MarketingPlan | undefined;
    if (!plan || !plan.persona || !Array.isArray(plan.platforms)) {
      plan = buildMarketingPlan({
        genreKey: detectGenreKey(text, title),
        titles: titles.length ? titles : [title],
        topCities,
        buyUrl: buyUrl || undefined,
        bundleTitles: bundleSuggestions.map((b) => b.title),
        bestHours,
        occasion: occasionHint(new Date(), detectGenreKey(text, title)),
      });
    } else if (!plan.occasion) {
      plan.occasion = occasionHint(new Date(), detectGenreKey(text, title));
    }

    return NextResponse.json({
      summary: (parsed.summary as string) ?? "",
      hook: (parsed.hook as string) ?? "",
      post_fb: (parsed.post_fb as string) ?? "",
      post_ig: (parsed.post_ig as string) ?? "",
      post_wa: (parsed.post_wa as string) ?? "",
      hashtags: (parsed.hashtags as string) ?? "",
      research_notes: (parsed.research_notes as string) ?? "",
      plan,
      bundleSuggestions,
      engine: "claude",
      model: response.model,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "generation failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
