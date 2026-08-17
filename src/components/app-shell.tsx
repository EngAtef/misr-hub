"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LogOut,
  Globe,
  Menu,
  X,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang, type DictKey } from "@/lib/i18n";
import { NAV, GROUP_LABELS, GROUP_ORDER, pageKey, type NavGroup } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { NotificationBell } from "@/components/notification-bell";
import { ActivityTracker } from "@/lib/activity-tracker";
import { DialogHost } from "@/components/dialog";
import { ForcePasswordChange } from "@/components/force-password-change";
import { Spinner } from "@/components/ui";
import type { Profile } from "@/lib/types";


export function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const { t, lang, setLang } = useLang();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [quickQ, setQuickQ] = useState("");
  const [permissions, setPermissions] = useState<Record<string, { a: boolean; m: boolean; v: boolean }> | null>(null);
  const [userOverrides, setUserOverrides] = useState<Record<string, boolean> | null>(null);
  const [overridesLoaded, setOverridesLoaded] = useState(false);

  // desktop sidebar collapse — remembered per browser
  useEffect(() => {
    if (localStorage.getItem("nmSidebarCollapsed") === "1") setCollapsed(true);
  }, []);

  function toggleSidebar() {
    setCollapsed((prev) => {
      localStorage.setItem("nmSidebarCollapsed", prev ? "0" : "1");
      return !prev;
    });
  }

  useEffect(() => {
    if (profile.is_owner) return;
    const supabase = createClient();
    supabase
      .from("page_permissions")
      .select("page_key, allow_admin, allow_manager, allow_viewer")
      .then(({ data }) => {
        const map: Record<string, { a: boolean; m: boolean; v: boolean }> = {};
        for (const r of (data as { page_key: string; allow_admin: boolean | null; allow_manager: boolean; allow_viewer: boolean }[]) ?? []) {
          map[r.page_key] = { a: r.allow_admin ?? true, m: r.allow_manager, v: r.allow_viewer };
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
        } else {
          const map: Record<string, boolean> = {};
          for (const r of rows) map[r.page_key] = r.allowed;
          setUserOverrides(map);
        }
        setOverridesLoaded(true);
      });
  }, [profile.role, profile.id, profile.is_owner]);

  // the owner sees everything; everyone else waits for both permission tables
  const permsReady = !!profile.is_owner || (permissions !== null && overridesLoaded);

  // Visibility rule:
  //   owner            → everything
  //   per-user grant   → wins (Users page checklist)
  //   page_permissions → role default (allow_admin / allow_manager / allow_viewer)
  //   no row at all    → a NEW section: owner only until access is granted
  const items = NAV.filter((item) => {
    if (profile.is_owner) return true;
    if (item.ownerOnly) return false;
    if (!item.roles.includes(profile.role)) return false;
    const key = pageKey(item.href);
    if (key === "profile") return true;
    if (userOverrides && userOverrides[key] !== undefined) return userOverrides[key];
    if (!permissions) return false;
    const perm = permissions[key];
    if (!perm) return false;
    return profile.role === "admin" ? perm.a : profile.role === "manager" ? perm.m : perm.v;
  });
  const canChat = items.some((i) => i.href === "/inbox");

  // Access guard: the menu already hides pages the account can't use, but the
  // route itself still rendered (login lands on "/" = overview, for one). Match
  // the current path to its nav item and, if it's not on the allowed list, send
  // the user to their first allowed page instead — or an access notice if none.
  const currentItem = NAV.find((item) =>
    item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/")
  );
  const currentAllowed = !currentItem || items.some((i) => i.href === currentItem.href);
  const firstAllowed = items[0]?.href;
  useEffect(() => {
    if (!permsReady || currentAllowed) return;
    if (firstAllowed && firstAllowed !== pathname) router.replace(firstAllowed);
  }, [permsReady, currentAllowed, firstAllowed, pathname, router]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="relative px-5 py-5 border-b border-brand-800">
        <button
          onClick={toggleSidebar}
          title={t("hideMenu")}
          aria-label={t("hideMenu")}
          className="absolute top-4 end-3 hidden rounded-lg p-1 text-brand-300 transition hover:bg-brand-800 hover:text-white lg:block"
        >
          {lang === "ar" ? <PanelRightClose size={18} /> : <PanelLeftClose size={18} />}
        </button>
        <Logo onDark />
        <div className="mt-1.5 text-[11px] text-brand-300">{t("appTagline")}</div>
        <form
          className="relative mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            const q = quickQ.trim();
            if (!q) return;
            setMobileOpen(false);
            router.push(`/orders?q=${encodeURIComponent(q)}`);
          }}
        >
          <input
            className="w-full rounded-lg border border-brand-800 bg-brand-900 px-3 py-1.5 pe-7 text-xs text-white placeholder-brand-400 outline-none focus:border-brand-500"
            placeholder={t("quickSearch")}
            value={quickQ}
            onChange={(e) => setQuickQ(e.target.value)}
          />
          {quickQ && (
            <button
              type="button"
              aria-label="clear search"
              className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-brand-400 hover:text-white"
              onClick={() => setQuickQ("")}
            >
              <X size={13} />
            </button>
          )}
        </form>
        <NotificationBell profile={profile} canCompose={canChat} />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {GROUP_ORDER.map((group) => {
          const groupItems = items.filter((i) => i.group === group);
          // a group whose every item is hidden by permissions disappears
          // along with its header
          if (groupItems.length === 0) return null;
          return (
            <div key={group} className="mb-4 last:mb-0">
              <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-400">
                {t(GROUP_LABELS[group])}
              </div>
              <div className="space-y-1">
                {groupItems.map((item) => {
                  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                        active ? "bg-brand-700 text-white" : "text-brand-200 hover:bg-brand-800 hover:text-white"
                      )}
                    >
                      <Icon className="h-4.5 w-4.5 shrink-0" size={18} />
                      {t(item.labelKey)}
                    </Link>
                  );
                })}
              </div>
            </div>
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

  // temporary / admin-reset password: nothing else renders until it is replaced
  if (profile.must_change_password) return <ForcePasswordChange profile={profile} />;

  return (
    <div className="min-h-screen">
      <ActivityTracker userId={profile.id} email={profile.email} />
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 start-0 z-30 hidden w-64 bg-brand-950",
          collapsed ? "lg:hidden" : "lg:block"
        )}
      >
        {sidebar}
      </aside>

      {/* Desktop reveal button (shown while the sidebar is hidden) */}
      {collapsed && (
        <button
          onClick={toggleSidebar}
          title={t("showMenu")}
          aria-label={t("showMenu")}
          className="fixed top-3 start-2 z-30 hidden rounded-lg bg-brand-950 p-2 text-white shadow-lg transition hover:bg-brand-800 lg:block"
        >
          {lang === "ar" ? <PanelRightOpen size={18} /> : <PanelLeftOpen size={18} />}
        </button>
      )}

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

      <main className={cn("p-4 lg:p-8 transition-[margin] duration-200", collapsed ? "lg:ms-12" : "lg:ms-64")}>
        {!permsReady ? (
          <div className="flex justify-center py-24">
            <Spinner />
          </div>
        ) : currentAllowed ? (
          children
        ) : firstAllowed ? (
          <div className="flex justify-center py-24">
            <Spinner />
          </div>
        ) : (
          <div className="mx-auto mt-24 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
              <ShieldCheck size={24} className="text-amber-600" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">{t("noPageAccess")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("noPageAccessHint")}</p>
          </div>
        )}
      </main>
      <DialogHost />
    </div>
  );
}
