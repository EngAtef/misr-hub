import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "../../../../lib/supabase/api-auth";
import { upcomingOccasions } from "../../../../lib/marketing/occasions";

export const maxDuration = 30;

// GET -> { picks, hours, dows, occasions }
// The "what should we market next" advisor: SKU opportunity ranking from real
// sales/stock data, the store's real posting-hour signal, and the Egyptian
// occasions calendar.
export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const lang = request.nextUrl.searchParams.get("lang") === "en" ? "en" as const : "ar" as const;
  const [advisor, hours] = await Promise.all([
    user.supabase.rpc("fn_marketing_advisor", { p_limit: 25 }),
    user.supabase.rpc("fn_best_post_hours"),
  ]);

  const bh = (hours.data ?? {}) as { hours?: { h: number; orders: number }[]; dows?: { d: number; orders: number }[] };

  return NextResponse.json({
    picks: advisor.data ?? [],
    hours: bh.hours ?? [],
    dows: bh.dows ?? [],
    occasions: upcomingOccasions(new Date(), lang).map((o) => ({
      key: o.key, name: o.name, date: o.date.toISOString().slice(0, 10),
      daysLeft: o.daysLeft, prepDays: o.prepDays, inPrepWindow: o.inPrepWindow,
      genres: o.genres, advice: o.advice, approximate: o.approximate ?? false,
    })),
  });
}
