// Server-side Meta Graph API helpers for the Marketing Studio: Facebook Page
// publishing, Instagram content publishing, per-post insights, and boosted-ad
// creation via the Marketing API. All calls are plain Graph API fetches.

const GRAPH = "https://graph.facebook.com/v21.0";

export interface MetaCreds {
  page_id?: string;
  page_access_token?: string;
  ig_user_id?: string;
  ad_account_id?: string;
  access_token?: string; // system-user token (ads_read / ads_management)
}

interface GraphError { message?: string; error_user_msg?: string; code?: number }

async function graph<T = Record<string, unknown>>(
  path: string,
  token: string,
  params?: Record<string, string>,
  method: "GET" | "POST" = "GET"
): Promise<T> {
  const qs = new URLSearchParams({ ...(method === "GET" ? params : {}), access_token: token });
  const url = `${GRAPH}/${path}?${qs.toString()}`;
  const res = await fetch(url, {
    method,
    headers: method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
    body: method === "POST" && params ? new URLSearchParams(params).toString() : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: GraphError };
  if (!res.ok || json.error) {
    const e = json.error;
    throw new Error(e?.error_user_msg || e?.message || `Meta API error (${res.status})`);
  }
  return json;
}

// ---------- Publishing ----------

// Publishes a photo post (or a plain feed post when no image) on the Page.
// Returns the full post id ("{page_id}_{post_id}").
export async function fbPublish(
  creds: MetaCreds,
  opts: { message: string; imageUrl?: string; link?: string }
): Promise<string> {
  const pageId = creds.page_id!;
  const token = creds.page_access_token!;
  if (opts.imageUrl) {
    const r = await graph<{ id: string; post_id?: string }>(`${pageId}/photos`, token, {
      url: opts.imageUrl,
      message: opts.message,
    }, "POST");
    return r.post_id ?? `${pageId}_${r.id}`;
  }
  const params: Record<string, string> = { message: opts.message };
  if (opts.link) params.link = opts.link;
  const r = await graph<{ id: string }>(`${pageId}/feed`, token, params, "POST");
  return r.id;
}

// Instagram content publishing: create a media container, wait for it to be
// ready, then publish. Requires a public image URL.
export async function igPublish(
  creds: MetaCreds,
  opts: { caption: string; imageUrl: string }
): Promise<{ mediaId: string; permalink: string | null }> {
  const igId = creds.ig_user_id!;
  const token = creds.page_access_token!;
  const container = await graph<{ id: string }>(`${igId}/media`, token, {
    image_url: opts.imageUrl,
    caption: opts.caption,
  }, "POST");

  // Poll the container until FINISHED (image fetch + processing is async).
  for (let i = 0; i < 10; i++) {
    const st = await graph<{ status_code?: string }>(`${container.id}`, token, { fields: "status_code" });
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR") throw new Error("Instagram rejected the image (container ERROR)");
    await new Promise((r) => setTimeout(r, 1500));
  }

  const pub = await graph<{ id: string }>(`${igId}/media_publish`, token, {
    creation_id: container.id,
  }, "POST");

  let permalink: string | null = null;
  try {
    const p = await graph<{ permalink?: string }>(`${pub.id}`, token, { fields: "permalink" });
    permalink = p.permalink ?? null;
  } catch {
    // permalink is nice-to-have
  }
  return { mediaId: pub.id, permalink };
}

// ---------- Insights ----------

export interface PostInsights {
  impressions?: number;
  reach?: number;
  clicks?: number;
  reactions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saved?: number;
  views?: number;
}

export async function fbPostInsights(creds: MetaCreds, postId: string): Promise<PostInsights> {
  const token = creds.page_access_token!;
  const out: PostInsights = {};
  try {
    const fields = await graph<{
      shares?: { count?: number };
      comments?: { summary?: { total_count?: number } };
      reactions?: { summary?: { total_count?: number } };
    }>(`${postId}`, token, {
      fields: "shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)",
    });
    out.shares = fields.shares?.count ?? 0;
    out.comments = fields.comments?.summary?.total_count ?? 0;
    out.reactions = fields.reactions?.summary?.total_count ?? 0;
  } catch {
    // keep whatever we managed to fetch
  }
  try {
    const ins = await graph<{ data?: { name: string; values?: { value?: number }[] }[] }>(
      `${postId}/insights`, token,
      { metric: "post_impressions,post_impressions_unique,post_clicks" }
    );
    for (const m of ins.data ?? []) {
      const v = m.values?.[0]?.value ?? 0;
      if (m.name === "post_impressions") out.impressions = v;
      if (m.name === "post_impressions_unique") out.reach = v;
      if (m.name === "post_clicks") out.clicks = v;
    }
  } catch {
    // page insights need the page token to own the post — non-fatal
  }
  return out;
}

export async function igMediaInsights(creds: MetaCreds, mediaId: string): Promise<PostInsights> {
  const token = creds.page_access_token!;
  const out: PostInsights = {};
  try {
    const f = await graph<{ like_count?: number; comments_count?: number }>(`${mediaId}`, token, {
      fields: "like_count,comments_count",
    });
    out.likes = f.like_count ?? 0;
    out.comments = f.comments_count ?? 0;
  } catch {
    // non-fatal
  }
  try {
    const ins = await graph<{ data?: { name: string; values?: { value?: number }[] }[] }>(
      `${mediaId}/insights`, token, { metric: "reach,views,saved,shares" }
    );
    for (const m of ins.data ?? []) {
      const v = m.values?.[0]?.value ?? 0;
      if (m.name === "reach") out.reach = v;
      if (m.name === "views") out.views = v;
      if (m.name === "saved") out.saved = v;
      if (m.name === "shares") out.shares = v;
    }
  } catch {
    // some metrics vary per media type — non-fatal
  }
  return out;
}

// ---------- Ads (boost) ----------

export interface BoostResult { campaign_id: string; adset_id: string; creative_id: string; ad_id: string }

// Creates campaign -> ad set -> creative(existing post) -> ad, all PAUSED so
// nothing spends until explicitly activated. Budget in EGP, converted to the
// account's minor units (piasters).
export async function createBoost(
  creds: MetaCreds,
  opts: { pagePostId: string; name: string; dailyBudgetEgp: number; days: number }
): Promise<BoostResult> {
  const act = `act_${(creds.ad_account_id ?? "").replace(/^act_/, "")}`;
  const token = creds.access_token!;

  const campaign = await graph<{ id: string }>(`${act}/campaigns`, token, {
    name: opts.name,
    objective: "OUTCOME_ENGAGEMENT",
    status: "PAUSED",
    special_ad_categories: "[]",
  }, "POST");

  const start = new Date();
  const end = new Date(start.getTime() + opts.days * 86400000);
  const adset = await graph<{ id: string }>(`${act}/adsets`, token, {
    name: `${opts.name} — ad set`,
    campaign_id: campaign.id,
    daily_budget: String(Math.round(opts.dailyBudgetEgp * 100)),
    billing_event: "IMPRESSIONS",
    optimization_goal: "POST_ENGAGEMENT",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: JSON.stringify({ geo_locations: { countries: ["EG"] } }),
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    status: "PAUSED",
  }, "POST");

  const creative = await graph<{ id: string }>(`${act}/adcreatives`, token, {
    name: `${opts.name} — creative`,
    object_story_id: opts.pagePostId,
  }, "POST");

  const ad = await graph<{ id: string }>(`${act}/ads`, token, {
    name: `${opts.name} — ad`,
    adset_id: adset.id,
    creative: JSON.stringify({ creative_id: creative.id }),
    status: "PAUSED",
  }, "POST");

  return { campaign_id: campaign.id, adset_id: adset.id, creative_id: creative.id, ad_id: ad.id };
}

export async function setAdStatus(
  creds: MetaCreds,
  ids: { campaign_id: string; adset_id: string; ad_id: string },
  status: "ACTIVE" | "PAUSED"
) {
  const token = creds.access_token!;
  // Activating an ad needs the whole chain active; pausing the campaign stops everything.
  const order = status === "ACTIVE"
    ? [ids.campaign_id, ids.adset_id, ids.ad_id]
    : [ids.ad_id, ids.adset_id, ids.campaign_id];
  for (const id of order) {
    await graph(`${id}`, token, { status }, "POST");
  }
}

export interface AdInsights { spend?: number; impressions?: number; clicks?: number; results?: number }

export async function adInsights(creds: MetaCreds, adId: string): Promise<AdInsights> {
  const token = creds.access_token!;
  const r = await graph<{ data?: { spend?: string; impressions?: string; clicks?: string; actions?: { action_type: string; value: string }[] }[] }>(
    `${adId}/insights`, token, { fields: "spend,impressions,clicks,actions", date_preset: "maximum" }
  );
  const row = r.data?.[0];
  if (!row) return {};
  const engagement = row.actions?.find((a) => a.action_type === "post_engagement")?.value;
  return {
    spend: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    results: engagement != null ? Number(engagement) : undefined,
  };
}
