"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Lang = "ar" | "en";

const dict = {
  // App
  appName: { ar: "مصر هب", en: "Misr Hub" },
  appTagline: { ar: "منصة إدارة العمليات والتقارير", en: "Operations & Reporting Platform" },
  // Navigation
  overview: { ar: "نظرة عامة", en: "Overview" },
  orders: { ar: "الطلبات", en: "Orders" },
  analytics: { ar: "التحليلات", en: "Analytics" },
  reports: { ar: "التقارير", en: "Reports" },
  dataCenter: { ar: "مركز البيانات", en: "Data Center" },
  users: { ar: "المستخدمون", en: "Users" },
  auditLog: { ar: "سجل النشاط", en: "Audit Log" },
  signOut: { ar: "تسجيل الخروج", en: "Sign out" },
  // Auth
  signIn: { ar: "تسجيل الدخول", en: "Sign in" },
  email: { ar: "البريد الإلكتروني", en: "Email" },
  password: { ar: "كلمة المرور", en: "Password" },
  signingIn: { ar: "جاري الدخول...", en: "Signing in..." },
  invalidLogin: { ar: "بيانات الدخول غير صحيحة", en: "Invalid email or password" },
  accountInactive: { ar: "هذا الحساب موقوف. تواصل مع المدير.", en: "This account is inactive. Contact your admin." },
  // Roles
  admin: { ar: "مدير النظام", en: "Admin" },
  manager: { ar: "مشرف", en: "Manager" },
  viewer: { ar: "مشاهد", en: "Viewer" },
  // KPIs
  totalOrders: { ar: "إجمالي الطلبات", en: "Total Orders" },
  grossRevenue: { ar: "إجمالي المبيعات", en: "Gross Revenue" },
  netRevenue: { ar: "صافي المبيعات", en: "Net Revenue" },
  delivered: { ar: "تم التوصيل", en: "Delivered" },
  cancelled: { ar: "ملغي", en: "Cancelled" },
  returned: { ar: "مرتجع", en: "Returned" },
  inProgress: { ar: "قيد التنفيذ", en: "In Progress" },
  avgOrderValue: { ar: "متوسط قيمة الطلب", en: "Avg Order Value" },
  uniqueCustomers: { ar: "عدد العملاء", en: "Unique Customers" },
  codOrders: { ar: "طلبات الدفع عند الاستلام", en: "COD Orders" },
  codAmount: { ar: "مبالغ الدفع عند الاستلام", en: "COD Amount" },
  onlinePaid: { ar: "مدفوعات أونلاين", en: "Online Payments" },
  avgDeliveryDays: { ar: "متوسط أيام التوصيل", en: "Avg Delivery Days" },
  customerRating: { ar: "تقييم العملاء", en: "Customer Rating" },
  driverRating: { ar: "تقييم المندوب", en: "Driver Rating" },
  deliveryRate: { ar: "نسبة التوصيل", en: "Delivery Rate" },
  cancellationRate: { ar: "نسبة الإلغاء", en: "Cancellation Rate" },
  returnRate: { ar: "نسبة المرتجعات", en: "Return Rate" },
  repeatCustomers: { ar: "عملاء متكررون", en: "Repeat Customers" },
  // Charts / sections
  ordersPerDay: { ar: "الطلبات يومياً", en: "Orders per Day" },
  revenuePerDay: { ar: "المبيعات يومياً", en: "Revenue per Day" },
  ordersByStatus: { ar: "الطلبات حسب الحالة", en: "Orders by Status" },
  ordersByPayment: { ar: "الطلبات حسب طريقة الدفع", en: "Orders by Payment Method" },
  ordersByCity: { ar: "الطلبات حسب المحافظة", en: "Orders by City" },
  ordersBySource: { ar: "الطلبات حسب المصدر", en: "Orders by Source" },
  topProducts: { ar: "الأكثر مبيعاً", en: "Top Products" },
  deliverySpeed: { ar: "سرعة التوصيل", en: "Delivery Speed" },
  deliveryStatusBreakdown: { ar: "حالات الشحن", en: "Delivery Status" },
  cancellationReasons: { ar: "أسباب الإلغاء", en: "Cancellation Reasons" },
  teamActivity: { ar: "نشاط الفريق", en: "Team Activity" },
  promotions: { ar: "العروض والحملات", en: "Promotions & Campaigns" },
  // Analytics tabs
  sales: { ar: "المبيعات", en: "Sales" },
  delivery: { ar: "التوصيل", en: "Delivery" },
  payments: { ar: "المدفوعات", en: "Payments" },
  geography: { ar: "المحافظات", en: "Geography" },
  products: { ar: "المنتجات", en: "Products" },
  returnsTab: { ar: "الإلغاء والمرتجعات", en: "Returns & Cancellations" },
  team: { ar: "الفريق", en: "Team" },
  // Filters
  dateRange: { ar: "الفترة", en: "Date Range" },
  last7: { ar: "آخر 7 أيام", en: "Last 7 days" },
  last30: { ar: "آخر 30 يوم", en: "Last 30 days" },
  last90: { ar: "آخر 90 يوم", en: "Last 90 days" },
  thisMonth: { ar: "هذا الشهر", en: "This month" },
  allTime: { ar: "كل الفترات", en: "All time" },
  custom: { ar: "مخصص", en: "Custom" },
  from: { ar: "من", en: "From" },
  to: { ar: "إلى", en: "To" },
  apply: { ar: "تطبيق", en: "Apply" },
  search: { ar: "بحث", en: "Search" },
  searchOrders: { ar: "رقم الطلب، اسم العميل، أو الهاتف...", en: "Order #, customer name, or phone..." },
  allStatuses: { ar: "كل الحالات", en: "All statuses" },
  allPayments: { ar: "كل طرق الدفع", en: "All payment methods" },
  allCities: { ar: "كل المحافظات", en: "All cities" },
  allSources: { ar: "كل المصادر", en: "All sources" },
  // Orders table
  orderNumber: { ar: "رقم الطلب", en: "Order #" },
  orderDate: { ar: "تاريخ الطلب", en: "Order Date" },
  customer: { ar: "العميل", en: "Customer" },
  phone: { ar: "الهاتف", en: "Phone" },
  city: { ar: "المحافظة", en: "City" },
  area: { ar: "المنطقة", en: "Area" },
  status: { ar: "الحالة", en: "Status" },
  paymentMethod: { ar: "طريقة الدفع", en: "Payment" },
  amount: { ar: "المبلغ", en: "Amount" },
  itemsCount: { ar: "عدد المنتجات", en: "Items" },
  source: { ar: "المصدر", en: "Source" },
  noResults: { ar: "لا توجد نتائج", en: "No results" },
  loading: { ar: "جاري التحميل...", en: "Loading..." },
  page: { ar: "صفحة", en: "Page" },
  of: { ar: "من", en: "of" },
  previous: { ar: "السابق", en: "Previous" },
  next: { ar: "التالي", en: "Next" },
  orderDetails: { ar: "تفاصيل الطلب", en: "Order Details" },
  orderItems: { ar: "المنتجات", en: "Items" },
  orderTimeline: { ar: "مسار الطلب", en: "Order Timeline" },
  deliveryInfo: { ar: "بيانات التوصيل", en: "Delivery Info" },
  paymentInfo: { ar: "بيانات الدفع", en: "Payment Info" },
  address: { ar: "العنوان", en: "Address" },
  notes: { ar: "ملاحظات", en: "Notes" },
  awb: { ar: "رقم البوليصة", en: "AWB" },
  deliveryDate: { ar: "تاريخ التوصيل", en: "Delivery Date" },
  shippingDate: { ar: "تاريخ الشحن", en: "Shipping Date" },
  close: { ar: "إغلاق", en: "Close" },
  // Data center
  uploadOrders: { ar: "رفع ملف الطلبات", en: "Upload Orders File" },
  uploadHint: { ar: "اسحب ملف OrderExport (.xlsx) هنا أو اضغط للاختيار", en: "Drop your OrderExport (.xlsx) file here or click to browse" },
  parsing: { ar: "جاري قراءة الملف...", en: "Parsing file..." },
  importing: { ar: "جاري الاستيراد...", en: "Importing..." },
  importComplete: { ar: "اكتمل الاستيراد بنجاح", en: "Import completed successfully" },
  importFailed: { ar: "فشل الاستيراد", en: "Import failed" },
  rowsFound: { ar: "صف تم العثور عليه", en: "rows found" },
  rowsImported: { ar: "صف تم استيراده", en: "rows imported" },
  rowsFailedLabel: { ar: "صف فشل", en: "rows failed" },
  startImport: { ar: "بدء الاستيراد", en: "Start Import" },
  cancel: { ar: "إلغاء", en: "Cancel" },
  uploadHistory: { ar: "سجل الرفع", en: "Upload History" },
  fileName: { ar: "اسم الملف", en: "File" },
  uploadedBy: { ar: "بواسطة", en: "By" },
  rows: { ar: "الصفوف", en: "Rows" },
  date: { ar: "التاريخ", en: "Date" },
  duplicateNote: { ar: "الطلبات المكررة يتم تحديثها تلقائياً بأحدث البيانات", en: "Existing orders are automatically updated with the latest data" },
  invalidFile: { ar: "ملف غير صالح — لم يتم العثور على عمود Order number", en: "Invalid file — 'Order number' column not found" },
  // Reports
  reportType: { ar: "نوع التقرير", en: "Report Type" },
  generateReport: { ar: "إنشاء التقرير", en: "Generate Report" },
  exportCsv: { ar: "تصدير CSV", en: "Export CSV" },
  exportAllOrders: { ar: "تصدير كل الطلبات (CSV)", en: "Export All Orders (CSV)" },
  reportSalesByDay: { ar: "المبيعات اليومية", en: "Daily Sales" },
  reportByCity: { ar: "المبيعات حسب المحافظة", en: "Sales by City" },
  reportByPayment: { ar: "المبيعات حسب طريقة الدفع", en: "Sales by Payment Method" },
  reportByStatus: { ar: "الطلبات حسب الحالة", en: "Orders by Status" },
  reportByDeliveryStatus: { ar: "الطلبات حسب حالة الشحن", en: "Orders by Delivery Status" },
  reportBySource: { ar: "الطلبات حسب المصدر", en: "Orders by Source" },
  reportTopProducts: { ar: "الأكثر مبيعاً", en: "Top Products" },
  reportTeam: { ar: "نشاط الفريق", en: "Team Activity" },
  reportCancellations: { ar: "أسباب الإلغاء", en: "Cancellation Reasons" },
  reportPromotions: { ar: "العروض والحملات", en: "Promotions & Campaigns" },
  // Users
  addUser: { ar: "إضافة مستخدم", en: "Add User" },
  fullName: { ar: "الاسم", en: "Name" },
  role: { ar: "الصلاحية", en: "Role" },
  active: { ar: "نشط", en: "Active" },
  inactive: { ar: "موقوف", en: "Inactive" },
  activate: { ar: "تفعيل", en: "Activate" },
  deactivate: { ar: "إيقاف", en: "Deactivate" },
  create: { ar: "إنشاء", en: "Create" },
  creating: { ar: "جاري الإنشاء...", en: "Creating..." },
  userCreated: { ar: "تم إنشاء المستخدم", en: "User created" },
  roleAdminDesc: { ar: "كل الصلاحيات + إدارة المستخدمين", en: "Full access + user management" },
  roleManagerDesc: { ar: "رفع البيانات + كل التقارير", en: "Upload data + all reports" },
  roleViewerDesc: { ar: "عرض التقارير فقط", en: "View dashboards & reports only" },
  // Audit
  action: { ar: "الإجراء", en: "Action" },
  details: { ar: "التفاصيل", en: "Details" },
  user: { ar: "المستخدم", en: "User" },
  // Insights
  insights: { ar: "توصيات ذكية", en: "Smart Insights" },
  insightsSubtitle: { ar: "توصيات تسويق وإيرادات ومخزون مبنية على بياناتك الفعلية", en: "Marketing, revenue & stock recommendations built from your real data" },
  marketingInsights: { ar: "توصيات التسويق", en: "Marketing" },
  revenueInsights: { ar: "توصيات الإيرادات", en: "Revenue" },
  stockInsights: { ar: "توصيات المخزون", en: "Stock & Products" },
  adsInsights: { ar: "توصيات إعلانات السوشيال ميديا", en: "Social Media Ads" },
  opsInsights: { ar: "توصيات التشغيل", en: "Operations" },
  attentionQueue: { ar: "طلبات تحتاج متابعة", en: "Orders Needing Attention" },
  daysOpen: { ar: "أيام مفتوحة", en: "Days Open" },
  reason: { ar: "السبب", en: "Reason" },
  stuck_in_delivery: { ar: "متأخر في الشحن (+5 أيام)", en: "Stuck in delivery (5+ days)" },
  return_pending: { ar: "طلب إرجاع معلق", en: "Return request pending" },
  not_shipped: { ar: "لم يُشحن بعد (+3 أيام)", en: "Not shipped yet (3+ days)" },
  delivery_failed: { ar: "فشل التوصيل", en: "Delivery failed" },
  // Campaigns
  campaigns: { ar: "الحملات", en: "Campaigns" },
  newCampaign: { ar: "حملة جديدة", en: "New Campaign" },
  editCampaign: { ar: "تعديل الحملة", en: "Edit Campaign" },
  campaignName: { ar: "اسم الحملة", en: "Campaign Name" },
  channel: { ar: "القناة", en: "Channel" },
  budget: { ar: "الميزانية", en: "Budget" },
  spent: { ar: "المصروف", en: "Spent" },
  promoCode: { ar: "كود الخصم", en: "Promo Code" },
  campaignKey: { ar: "معرف الحملة (Campaign Id)", en: "Campaign Id (matches export)" },
  targetAudience: { ar: "الجمهور المستهدف", en: "Target Audience" },
  startDate: { ar: "تاريخ البداية", en: "Start Date" },
  endDate: { ar: "تاريخ النهاية", en: "End Date" },
  roi: { ar: "العائد على الإنفاق", en: "ROAS" },
  attributedOrders: { ar: "طلبات الحملة", en: "Attributed Orders" },
  attributedRevenue: { ar: "إيرادات الحملة", en: "Attributed Revenue" },
  save: { ar: "حفظ", en: "Save" },
  delete: { ar: "حذف", en: "Delete" },
  draft: { ar: "مسودة", en: "Draft" },
  activeCampaign: { ar: "نشطة", en: "Active" },
  paused: { ar: "متوقفة", en: "Paused" },
  completed: { ar: "مكتملة", en: "Completed" },
  campaignHint: { ar: "يتم ربط الطلبات بالحملة عن طريق كود الخصم أو معرف الحملة في ملف الطلبات", en: "Orders are attributed via the promo code or Campaign Id found in the orders export" },
  // Misc
  refresh: { ar: "تحديث", en: "Refresh" },
  ordersLabel: { ar: "طلب", en: "orders" },
  revenue: { ar: "المبيعات", en: "Revenue" },
  quantity: { ar: "الكمية", en: "Qty" },
  days: { ar: "يوم", en: "days" },
  noData: { ar: "لا توجد بيانات — ارفع ملف الطلبات من مركز البيانات", en: "No data yet — upload an orders file from the Data Center" },
  error: { ar: "حدث خطأ", en: "Something went wrong" },
} as const;

export type DictKey = keyof typeof dict;

const LangContext = createContext<{
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: DictKey) => string;
}>({ lang: "ar", setLang: () => {}, t: (k) => k });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ar");

  useEffect(() => {
    const saved = typeof window !== "undefined" ? (localStorage.getItem("lang") as Lang | null) : null;
    if (saved === "en" || saved === "ar") setLangState(saved);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("lang", l);
  };

  const t = (key: DictKey) => dict[key]?.[lang] ?? key;

  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}
