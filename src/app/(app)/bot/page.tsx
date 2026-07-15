"use client";

import { PageHeader } from "@/components/ui";
import { useLang } from "@/lib/i18n";
import { useMyRole } from "@/lib/use-role";
import { BotConnectionSettings, BotScriptEditor } from "@/components/chatwoot-bot-settings";

// After-Hours Bot: standalone page so access can be granted per user from
// Users → page checklist. Connection/tokens show for admins only; the
// reply-script editor is available to anyone who can open the page (RLS on
// app_settings key "chatwoot_bot_script" enforces the same rule server-side).

export default function BotPage() {
  const { t } = useLang();
  const role = useMyRole();

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title={t("afterHoursBot")} subtitle={t("afterHoursBotSubtitle")} />
      {role === "admin" && <BotConnectionSettings />}
      <BotScriptEditor />
    </div>
  );
}
