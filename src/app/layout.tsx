import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import { LangProvider } from "@/lib/i18n";
import "./globals.css";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  variable: "--font-cairo",
});

export const metadata: Metadata = {
  title: "NM Smart App",
  description: "Nahdet Misr Bookstore operations & reporting - إدارة المكتبة الإلكترونية",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className={`${cairo.variable} font-sans bg-slate-50 text-slate-900 antialiased`}>
        <LangProvider>{children}</LangProvider>
      </body>
    </html>
  );
}
