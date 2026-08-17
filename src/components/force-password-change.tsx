"use client";

// Full-screen gate shown by the app shell while profile.must_change_password
// is set. There is no way past it except picking a new password (or signing
// out). change_own_password() enforces the policy server-side and clears
// the flag; router.refresh() then re-reads the profile in the layout.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { isStrongPassword } from "@/lib/password";
import { PasswordField } from "@/components/password-field";
import { Logo } from "@/components/logo";
import type { Profile } from "@/lib/types";

export function ForcePasswordChange({ profile }: { profile: Profile }) {
  const { t, lang, setLang } = useLang();
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const strong = isStrongPassword(pw);
  const match = pw.length > 0 && pw === pw2;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!strong) return setError(t("pwWeak"));
    if (!match) return setError(t("pwMismatch"));
    setSaving(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.rpc("change_own_password", { p_password: pw });
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    router.refresh();
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-900/5 sm:p-8">
          <div className="mb-5 flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50">
              <KeyRound size={22} className="text-brand-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">{t("pwForceTitle")}</h1>
              <p className="mt-1 text-sm text-slate-500">{t("pwForceHint")}</p>
              <p className="mt-1 text-xs text-slate-400" dir="ltr">
                {profile.email}
              </p>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">{t("newPassword")}</label>
              <PasswordField value={pw} onChange={setPw} required autoFocus />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">{t("pwConfirm")}</label>
              <PasswordField value={pw2} onChange={setPw2} required showRules={false} />
              {pw2.length > 0 && !match && <p className="mt-1 text-[11px] text-red-600">{t("pwMismatch")}</p>}
            </div>
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}
            <button type="submit" className="btn-primary w-full" disabled={saving || !strong || !match}>
              {saving ? t("saving") : t("pwSaveAndContinue")}
            </button>
          </form>

          <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-xs">
            <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="text-slate-500 hover:text-slate-800">
              {lang === "ar" ? "English" : "العربية"}
            </button>
            <button onClick={signOut} className="flex items-center gap-1.5 text-slate-500 hover:text-slate-800">
              <LogOut size={14} />
              {t("signOut")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
