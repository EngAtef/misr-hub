"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingCart,
  BarChart3,
  FileText,
  UploadCloud,
  Users,
  ScrollText,
  LogOut,
  Globe,
  BookOpen,
  Menu,
  X,
  Lightbulb,
  Megaphone,
  HeartHandshake,
  Package,
  Target,
  Boxes,
  Sparkles,
  Contact,
  Settings,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/types";

interface NavItem {
  href: string;
  labelKey: DictKey;
  icon: React.ElementType;
  roles: string[];
}

const NAV: NavItem[] = [
  { href: "/", labelKey: "overview", icon: LayoutDashboard, roles: ["admin", "manager", "viewer"] },
  { href: "/assistant", labelKey: "assistant", icon: Sparkles, roles: ["admin", "manager", "viewer"] },
  { href: "/orders", labelKey: "orders", icon: ShoppingCart, roles: ["admin", "manager", "viewer"] },
  { href: "/products", labelKey: "productsPage", icon: Package, roles: ["admin", "manager", "viewer"] },
  { href: "/analytics", labelKey: "analytics", icon: BarChart3, roles: ["admin", "manager", "viewer"] },
  { href: "/insights", labelKey: "insights", icon: Lightbulb, roles: ["admin", "manager", "viewer"] },
  { href: "/customers", labelKey: "customers", icon: HeartHandshake, roles: ["admin", "manager", "viewer"] },
  { href: "/ads", labelKey: "ads", icon: Megaphone, roles: ["admin", "manager", "viewer"] },
  { href: "/campaigns", labelKey: "campaigns", icon: Target, roles: ["admin", "manager", "viewer"] },
  { href: "/stock", labelKey: "stock", icon: Boxes, roles: ["admin", "manager", "viewer"] },
  { href: "/targets", labelKey: "targets", icon: Target, roles: ["admin", "manager", "viewer"] },
  { href: "/reports", labelKey: "reports", icon: FileText, roles: ["admin", "manager", "viewer"] },
  { href: "/team", labelKey: "teamContacts", icon: Contact, roles: ["admin", "manager"] },
  { href: "/data-center", labelKey: "dataCenter", icon: UploadCloud, roles: ["admin", "manager"] },
  { href: "/users", labelKey: "users", icon: Users, roles: ["admin"] },
  { href: "/settings", labelKey: "settings", icon: Settings, roles: ["admin"] },
  { href: "/audit", labelKey: "auditLog", icon: ScrollText, roles: ["admin"] },
];

export function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const { t, lang, setLang } = useLang();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const items = NAV.filter((item) => item.roles.includes(profile.role));

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-brand-800">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold">
          <BookOpen className="h-5 w-5 text-brand-950" />
        </div>
        <div>
          <div className="font-bold text-white leading-tight">{t("appName")}</div>
          <div className="text-[11px] text-brand-300">{t("appTagline")}</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                active
                  ? "bg-brand-700 text-white"
                  : "text-brand-200 hover:bg-brand-800 hover:text-white"
              )}
            >
              <Icon className="h-4.5 w-4.5 shrink-0" size={18} />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-brand-800 px-3 py-4 space-y-2">
        <div className="px-3">
          <div className="text-sm font-semibold text-white truncate">
            {profile.full_name || profile.email}
          </div>
          <div className="text-xs text-brand-300">{t(profile.role as DictKey)}</div>
        </div>
        <button
          onClick={() => setLang(lang === "ar" ? "en" : "ar")}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-brand-200 hover:bg-brand-800 hover:text-white transition"
        >
          <Globe size={18} />
          {lang === "ar" ? "English" : "العربية"}
        </button>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-brand-200 hover:bg-brand-800 hover:text-white transition"
        >
          <LogOut size={18} />
          {t("signOut")}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 bg-brand-950 lg:block">{sidebar}</aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-64 bg-brand-950">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 end-3 text-brand-200 hover:text-white"
            >
              <X size={20} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      {/* Mobile top bar */}
      <div className="sticky top-0 z-20 flex items-center gap-3 bg-brand-950 px-4 py-3 lg:hidden">
        <button onClick={() => setMobileOpen(true)} className="text-white">
          <Menu size={22} />
        </button>
        <span className="font-bold text-white">{t("appName")}</span>
      </div>

      <main className="lg:ms-64 p-4 lg:p-8">{children}</main>
    </div>
  );
}
