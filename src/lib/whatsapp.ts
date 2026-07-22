// WhatsApp deep-link helpers. No API account needed:
// wa.me links open WhatsApp with a prefilled message.

// Normalizes Egyptian phone numbers to international format (20...)
export function normalizeEgyptPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0020")) digits = digits.slice(4);
  else if (digits.startsWith("20") && digits.length >= 12) {
    // already international
  } else if (digits.startsWith("0")) {
    digits = "20" + digits.slice(1);
  } else if (digits.startsWith("1") && digits.length === 10) {
    digits = "20" + digits;
  }
  if (digits.length < 11) return null;
  return digits;
}

export type FollowUpReason =
  | "stuck_in_delivery"
  | "return_pending"
  | "not_shipped"
  | "delivery_failed"
  | "birthday"
  | "winback"
  | "general";

interface TemplateInput {
  customerName: string | null;
  orderNumber: string;
}

const TEMPLATES: Record<FollowUpReason, (i: TemplateInput) => { ar: string; en: string }> = {
  stuck_in_delivery: ({ customerName, orderNumber }) => ({
    ar: `مرحباً ${customerName ?? "عميلنا العزيز"} 🌹\nنعتذر عن التأخير في توصيل طلبك رقم #${orderNumber}. نتابع الشحنة مع شركة الشحن الآن وسيصلك في أقرب وقت.\nهل ما زلت ترغب في استلام الطلب؟`,
    en: `Hello ${customerName ?? "dear customer"} 🌹\nWe apologize for the delay in delivering your order #${orderNumber}. We are following up with the courier and it will arrive soon.\nWould you still like to receive the order?`,
  }),
  return_pending: ({ customerName, orderNumber }) => ({
    ar: `مرحباً ${customerName ?? "عميلنا العزيز"} 🌹\nبخصوص طلب الإرجاع للطلب رقم #${orderNumber} — نرجو تأكيد العنوان والوقت المناسب لاستلام المرتجع منك.`,
    en: `Hello ${customerName ?? "dear customer"} 🌹\nRegarding the return request for order #${orderNumber} — please confirm the address and a suitable time for the pickup.`,
  }),
  not_shipped: ({ customerName, orderNumber }) => ({
    ar: `مرحباً ${customerName ?? "عميلنا العزيز"} 🌹\nنؤكد استلامنا لطلبك رقم #${orderNumber} وجاري تجهيزه للشحن. نرجو تأكيد رغبتك في الاستلام وسنشحنه فوراً.`,
    en: `Hello ${customerName ?? "dear customer"} 🌹\nWe confirm receiving your order #${orderNumber} and it is being prepared. Please confirm you would like to receive it and we will ship immediately.`,
  }),
  delivery_failed: ({ customerName, orderNumber }) => ({
    ar: `مرحباً ${customerName ?? "عميلنا العزيز"} 🌹\nحاول المندوب توصيل طلبك رقم #${orderNumber} ولم يتمكن من الوصول إليك. ما هو الوقت المناسب لإعادة محاولة التوصيل؟`,
    en: `Hello ${customerName ?? "dear customer"} 🌹\nOur courier attempted to deliver your order #${orderNumber} but couldn't reach you. What time suits you for another delivery attempt?`,
  }),
  birthday: ({ customerName }) => ({
    ar: `كل سنة وأنت طيب ${customerName ?? ""} 🎂🎈\nمكتبة نهضة مصر بتحتفل معاك بعيد ميلادك! 🎁 استخدم كود BDAY وخد خصم خاص على طلبك الجاي من موقعنا. عقبال 100 كتاب! 📚`,
    en: `Happy birthday ${customerName ?? ""} 🎂🎈\nNahdet Misr Bookstore is celebrating with you! 🎁 Use code BDAY for a special discount on your next order. Here's to 100 more books! 📚`,
  }),
  winback: ({ customerName }) => ({
    ar: `مرحباً ${customerName ?? "عميلنا العزيز"} 🌹\nوحشتنا في مكتبة نهضة مصر! 📚 سجلت عندنا ولسه ما جربتش أول طلب — استخدم كود WELCOME وخد خصم خاص على أول طلبية، مع توصيل لباب البيت.`,
    en: `Hello ${customerName ?? "dear customer"} 🌹\nWe miss you at Nahdet Misr Bookstore! 📚 You registered but haven't tried your first order yet — use code WELCOME for a special first-order discount, delivered to your door.`,
  }),
  general: ({ customerName, orderNumber }) => ({
    ar: `مرحباً ${customerName ?? "عميلنا العزيز"} 🌹\nنتواصل معك بخصوص طلبك رقم #${orderNumber}.`,
    en: `Hello ${customerName ?? "dear customer"} 🌹\nWe are contacting you regarding your order #${orderNumber}.`,
  }),
};

// Cart-recovery message with the actual abandoned products. Kept separate
// from TEMPLATES because it needs the product list, not an order number.
export function abandonedCartLink(
  phone: string | null | undefined,
  input: { customerName: string | null; products: string[]; cartValue: number | null; promoCode?: string | null },
  lang: "ar" | "en" = "ar"
): string | null {
  const normalized = normalizeEgyptPhone(phone);
  if (!normalized) return null;
  const list = input.products.slice(0, 3).join("، ");
  const listEn = input.products.slice(0, 3).join(", ");
  const more = input.products.length > 3 ? ` +${input.products.length - 3}` : "";
  const promo = input.promoCode?.trim();
  const promoAr = promo ? `\n🎁 استخدم كود ${promo} وكمل طلبك بخصم خاص` : "";
  const promoEn = promo ? `\n🎁 Use code ${promo} for a special discount on your order` : "";
  const message =
    lang === "ar"
      ? `مرحباً ${input.customerName ?? "عميلنا العزيز"} 🌹\nلاحظنا إنك اخترت ${list ? `«${list}»${more}` : "كتب مميزة"} في سلتك على متجر نهضة مصر وما كملتش الطلب 🛒\nالكتب لسه مستنياك — لو حابب نساعدك تكمل طلبك أو عندك أي سؤال، رد علينا هنا وهنساعدك فوراً 📚${promoAr}`
      : `Hello ${input.customerName ?? "dear customer"} 🌹\nWe noticed you left ${listEn ? `"${listEn}"${more}` : "some great books"} in your cart at Nahdet Misr store 🛒\nThey are still waiting for you — reply here if you'd like help completing your order 📚${promoEn}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export function whatsappLink(
  phone: string | null | undefined,
  reason: FollowUpReason,
  input: TemplateInput,
  lang: "ar" | "en" = "ar"
): string | null {
  const normalized = normalizeEgyptPhone(phone);
  if (!normalized) return null;
  const message = TEMPLATES[reason](input)[lang];
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
