"use client";

import { Phone, Mail, MessageCircle } from "lucide-react";
import { whatsappLink, normalizeEgyptPhone, type FollowUpReason } from "@/lib/whatsapp";
import { useLang } from "@/lib/i18n";

// One consistent set of contact buttons: call, WhatsApp, email.
// Renders only the channels that exist for the person.
export function ContactActions({
  phone,
  email,
  name,
  waReason = "general",
  orderNumber = "",
  compact = true,
}: {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  waReason?: FollowUpReason;
  orderNumber?: string;
  compact?: boolean;
}) {
  const { t, lang } = useLang();
  const tel = normalizeEgyptPhone(phone);
  const wa = whatsappLink(phone, waReason, { customerName: name ?? null, orderNumber }, lang);

  const base = compact
    ? "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold"
    : "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold";

  if (!tel && !wa && !email) return <span className="text-slate-300">—</span>;

  return (
    <div className="flex items-center gap-1">
      {tel && (
        <a href={`tel:+${tel}`} className={`${base} bg-brand-50 text-brand-700 hover:bg-brand-100`} title={t("callAction")}>
          <Phone size={13} />
          {!compact && t("callAction")}
        </a>
      )}
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className={`${base} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
          title="WhatsApp"
        >
          <MessageCircle size={13} />
          {!compact && "WhatsApp"}
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} className={`${base} bg-slate-100 text-slate-600 hover:bg-slate-200`} title={t("sendEmail")}>
          <Mail size={13} />
          {!compact && t("sendEmail")}
        </a>
      )}
    </div>
  );
}
