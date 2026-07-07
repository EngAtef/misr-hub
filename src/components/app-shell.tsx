"use client";

import { useState, useEffect } from "react";
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
  MousePointerClick,
  Flag,
  Truck,
  BookOpen,
  UserCircle,
  Store,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import type { Profile } from "@/lib/types";

interface NavItem {
  href: string;
  labelKey: DictKey;
  icon: React.ElementType;
  roles: string[];
}

const NAV: NavItem[] = [
  { href: "/", labelKey: "overview", icon: LayoutDashboard, roles: ["admin", "manager", "viewer"] },
  { href: "/orders", labelKey: "orders", icon: ShoppingCart, roles: ["admin", "manager", "viewer"] },
  { href: "/products", labelKey: "productsPage", icon: Package, roles: ["admin", "manager", "viewer"] },
  { href: "/analytics", labelKey: "analytics", icon: BarChart3, roles: ["admin", "manager", "viewer"] },
  { href: "/traffic", labelKey: "traffic", icon: MousePointerClick, roles: ["admin", "manager", "viewer"] },
  { href: "/insights", labelKey: "insights", icon: Lightbulb, roles: ["admin", "manager", "viewer"] },
  { href: "/customers", labelKey: "customers", icon: HeartHandshake, roles: ["admin", "manager", "viewer"] },
  { href: "/ads", labelKey: "ads", icon: Megaphone, roles: ["admin", "manager", "viewer"] },
  { href: "/campaigns", labelKey: "campaigns", icon: Flag, roles: ["admin", "manager", "viewer"] },
  { href: "/delivery", labelKey: "deliveryReports", icon: Truck, roles: ["admin", "manager", "viewer"] },
  { href: "/stock", labelKey: "stock", icon: Boxes, roles: ["admin", "manager", "viewer"] },
  { href: "/catalog", labelKey: "catalog", icon: BookOpen, roles: ["admin", "manager", "viewer"] },
  { href: "/vendors", labelKey: "vendors", icon: Store, roles: ["admin", "manager", "viewer"] },
  { href: "/targets", labelKey: "targets", icon: Target, roles: ["admin", "manager", "viewer"] },
  { href: "/reports", labelKey: "reports", icon: FileText, roles: ["admin", "manager", "viewer"] },
  { href: "/team", labelKey: "teamContacts", icon: Contact, roles: ["admin", "manager"] },
  { href: "/data-center", labelKey: "dataCenter", icon: UploadCloud, roles: ["admin", "manager"] },
  { href: "/studio", labelKey: "studio", icon: BookOpen, roles: ["admin", "manager"] },
  { href: "/assistant", labelKey: "assistant", icon: Sparkles, roles: ["admin", "manager", "viewer"] },
  { href: "/profile", labelKey: "profile", icon: UserCircle, roles: ["admin", "manager", "viewer"] },
  { href: "/users", labelKey: "users", icon: Users, roles: ["admin"] },
  { href: "/settings", labelKey: "settings", icon: Settings, roles: ["admin"] },
  { href: "/audit", labelKey: "auditLog", icon: ScrollText, roles: ["admin"] },
];

// href -> page_permissions.page_key
function pageKey(href: string): string {
  return href === "/" ? "overview" : href.slice(1);
}

export function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const { t, lang, setLang } = useLang();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [quickQ, setQuickQ] = useState("");
  const [permissions, setPermissions] = useState<Record<string, { m: boolean; v: boolean }> | null>(null);
  const [userOverrides, setUserOverrides] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    if (profile.role === "admin") return;
    const supabase = createClient();
    supabase
      .from("page_permissions")
      .select("page_key, allow_manager, allow_viewer")
      .then(({ data }) => {
        const map: Record<string, { m: boolean; v: boolean }> = {};
        for (const r of (data as { page_key: string; allow_manager: boolean; allow_viewer: boolean }[]) ?? []) {
          map[r.page_key] = { m: r.allow_manager, v: r.allow_viewer };
        }
        setPermissions(map);
      });
    supabase
      .from("user_page_access")
      .select("page_key, allowed")
      .eq("user_id", profile.id)
      .then(({ data }) => {
        const rows = (data as { page_key: string; allowed: boolean }[]) ?? [];
        if (!rows.length) {
          setUserOverrides(null);
          return;
        }
        const map: Record<string, boolean> = {};
        for (const r of rows) map[r.page_key] = r.allowed;
        setUserOverrides(map);
      });
  }, [profile.role, profile.id]);

  const items = NAV.filter((item) => {
    if (!item.roles.includes(profile.role)) return false;
    if (profile.role === "admin") return true;
    const key = pageKey(item.href);
    // per-account checklist wins over role defaults
    if (userOverrides && userOverrides[key] !== undefined) return userOverrides[key];
    if (!permissions) return true;
    const perm = permissions[key];
    if (!perm) return true;
    return profile.role === "manager" ? perm.m : perm.v;
  });

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-5 py-5 border-b border-brand-800">
        <Logo onDark />
        <div className="mt-1.5 text-[11px] text-brand-300">{t("appTagline")}</div>
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            const q = quickQ.trim();
            if (!q) return;
            setMobileOpen(false);
            router.push(`/orders?q=${encodeURIComponent(q)}`);
          }}
        >
          <input
            className="w-full rounded-lg border border-brand-800 bg-brand-900 px-3 py-1.5 text-xs text-white placeholder-brand-400 outline-none focus:border-brand-500"
            placeholder={t("quickSearch")}
            value={quickQ}
            onChange={(e) => setQuickQ(e.target.value)}
          />
        </form>
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
