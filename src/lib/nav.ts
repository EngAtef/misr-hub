// Single source of truth for the sidebar AND the access checklists.
// Adding a page here makes it appear in Users → "Pages this account can
// access" automatically. A page with no page_permissions row and no
// per-user grant is visible to the OWNER only (see app-shell.tsx).
import type { DictKey } from "@/lib/i18n";
import {
  LayoutDashboard,
  ShoppingCart,
  BarChart3,
  FileText,
  UploadCloud,
  Users,
  ScrollText,
  Lightbulb,
  Megaphone,
  Wand2,
  HeartHandshake,
  Package,
  Target,
  Boxes,
  Sparkles,
  Bot,
  Contact,
  Settings,
  MousePointerClick,
  Flag,
  Truck,
  BookOpen,
  LayoutGrid,
  UserCircle,
  Store,
  Coins,
  Undo2,
  Landmark,
  MessageSquare,
  ShieldCheck,
  ShoppingBasket,
  Crosshair,
  UsersRound,
  Radar,
} from "lucide-react";

export type NavGroup = "daily" | "sales" | "catalog" | "marketing" | "finance" | "tools" | "admin";

export interface NavItem {
  href: string;
  labelKey: DictKey;
  icon: React.ElementType;
  roles: string[];
  group: NavGroup;
  ownerOnly?: boolean;
}

export const GROUP_LABELS: Record<NavGroup, DictKey> = {
  daily: "navGroupDaily",
  sales: "navGroupSales",
  catalog: "navGroupCatalog",
  marketing: "navGroupMarketing",
  finance: "navGroupFinance",
  tools: "navGroupTools",
  admin: "navGroupAdmin",
};

// Render order of the groups. Items keep their order within a group.
export const GROUP_ORDER: NavGroup[] = ["daily", "sales", "catalog", "marketing", "finance", "tools", "admin"];

export const NAV: NavItem[] = [
  // Daily — what you open every morning
  { href: "/", labelKey: "overview", icon: LayoutDashboard, roles: ["admin", "manager", "viewer"], group: "daily" },
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutGrid, roles: ["admin", "manager", "viewer"], group: "daily" },
  { href: "/insights", labelKey: "insights", icon: Lightbulb, roles: ["admin", "manager", "viewer"], group: "daily" },
  { href: "/assistant", labelKey: "assistant", icon: Sparkles, roles: ["admin", "manager", "viewer"], group: "daily" },

  // Sales & customers — the demand side
  { href: "/orders", labelKey: "orders", icon: ShoppingCart, roles: ["admin", "manager", "viewer"], group: "sales" },
  { href: "/customers", labelKey: "customers", icon: HeartHandshake, roles: ["admin", "manager", "viewer"], group: "sales" },
  { href: "/segments", labelKey: "segments", icon: UsersRound, roles: ["admin", "manager", "viewer"], group: "sales" },
  { href: "/abandoned", labelKey: "abandoned", icon: ShoppingBasket, roles: ["admin", "manager", "viewer"], group: "sales" },
  { href: "/delivery", labelKey: "deliveryReports", icon: Truck, roles: ["admin", "manager", "viewer"], group: "sales" },
  { href: "/returns", labelKey: "returns", icon: Undo2, roles: ["admin", "manager", "viewer"], group: "sales" },
  { href: "/analytics", labelKey: "analytics", icon: BarChart3, roles: ["admin", "manager", "viewer"], group: "sales" },
  { href: "/reports", labelKey: "reports", icon: FileText, roles: ["admin", "manager", "viewer"], group: "sales" },

  // Catalog & stock — the supply side
  { href: "/products", labelKey: "productsPage", icon: Package, roles: ["admin", "manager", "viewer"], group: "catalog" },
  { href: "/stock", labelKey: "stock", icon: Boxes, roles: ["admin", "manager", "viewer"], group: "catalog" },
  { href: "/catalog", labelKey: "catalog", icon: BookOpen, roles: ["admin", "manager", "viewer"], group: "catalog" },
  { href: "/vendors", labelKey: "vendors", icon: Store, roles: ["admin", "manager", "viewer"], group: "catalog" },

  // Marketing — spend and reach
  { href: "/traffic", labelKey: "traffic", icon: MousePointerClick, roles: ["admin", "manager", "viewer"], group: "marketing" },
  { href: "/ads", labelKey: "ads", icon: Megaphone, roles: ["admin", "manager", "viewer"], group: "marketing" },
  { href: "/gaps", labelKey: "gaps", icon: Crosshair, roles: ["admin", "manager", "viewer"], group: "marketing" },
  { href: "/audiences", labelKey: "audiences", icon: Radar, roles: ["admin", "manager", "viewer"], group: "marketing" },
  { href: "/campaigns", labelKey: "campaigns", icon: Flag, roles: ["admin", "manager", "viewer"], group: "marketing" },
  { href: "/marketing", labelKey: "marketing", icon: Wand2, roles: ["admin", "manager", "viewer"], group: "marketing" },

  // Finance — the money
  { href: "/pnl", labelKey: "pnl", icon: Landmark, roles: ["admin", "manager"], group: "finance" },
  { href: "/profit", labelKey: "profit", icon: Coins, roles: ["admin", "manager"], group: "finance" },
  { href: "/targets", labelKey: "targets", icon: Target, roles: ["admin", "manager", "viewer"], group: "finance" },

  // Tools
  { href: "/data-center", labelKey: "dataCenter", icon: UploadCloud, roles: ["admin", "manager"], group: "tools" },
  { href: "/studio", labelKey: "studio", icon: BookOpen, roles: ["admin", "manager"], group: "tools" },
  { href: "/bot", labelKey: "afterHoursBot", icon: Bot, roles: ["admin", "manager", "viewer"], group: "tools" },
  { href: "/inbox", labelKey: "inbox", icon: MessageSquare, roles: ["admin", "manager", "viewer"], group: "tools" },
  { href: "/team", labelKey: "teamContacts", icon: Contact, roles: ["admin", "manager"], group: "tools" },

  // Administration
  { href: "/profile", labelKey: "profile", icon: UserCircle, roles: ["admin", "manager", "viewer"], group: "admin" },
  { href: "/users", labelKey: "users", icon: Users, roles: ["admin"], group: "admin" },
  { href: "/settings", labelKey: "settings", icon: Settings, roles: ["admin"], group: "admin" },
  { href: "/audit", labelKey: "auditLog", icon: ScrollText, roles: ["admin"], group: "admin" },
  { href: "/control", labelKey: "controlCenter", icon: ShieldCheck, roles: ["admin"], group: "admin", ownerOnly: true },
];

// href -> page_permissions.page_key
export function pageKey(href: string): string {
  return href === "/" ? "overview" : href.slice(1);
}

// Pages that can be granted per role / per user — everything except the
// admin-only pages and the personal profile.
export const ACCESS_PAGES: { key: string; labelKey: DictKey }[] = NAV.filter(
  (i) => !i.ownerOnly && i.roles.some((r) => r !== "admin") && i.href !== "/profile"
).map((i) => ({ key: pageKey(i.href), labelKey: i.labelKey }));
