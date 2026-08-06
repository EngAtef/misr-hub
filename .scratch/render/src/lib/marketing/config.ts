// Loads Marketing Studio credentials (AI + Meta) for API routes through the
// role-gated fn_marketing_config() RPC, with env-var fallback for the AI key.
import type { ApiUser } from "../../lib/supabase/api-auth";
import type { MetaCreds } from "./meta";

export interface MarketingConfig {
  aiKey: string | null;
  aiModel: string;
  meta: MetaCreds;
}

export async function getMarketingConfig(user: ApiUser): Promise<MarketingConfig> {
  const { data } = await user.supabase.rpc("fn_marketing_config");
  const cfg = (data ?? {}) as { ai?: Record<string, string>; meta?: MetaCreds };
  return {
    aiKey: cfg.ai?.anthropic_api_key || process.env.ANTHROPIC_API_KEY || null,
    aiModel: cfg.ai?.model || "claude-opus-5",
    meta: cfg.meta ?? {},
  };
}
