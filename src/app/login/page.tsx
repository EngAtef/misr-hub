"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { Logo } from "@/components/logo";

export default function LoginPage() {
  const { t, lang, setLang } = useLang();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  async function finishLogin(supabase: ReturnType<typeof createClient>, userId: string) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("id", userId)
      .single();
    if (profile && !profile.is_active) {
      await supabase.auth.signOut();
      setError(t("accountInactive"));
      setLoading(false);
      return;
    }
    // login history + new-device alert to the owner; must never block sign-in
    supabase.rpc("register_login").then(
      () => undefined,
      () => undefined
    );
    router.push("/");
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError || !data.user) {
      supabase.rpc("log_failed_login", { p_email: email }).then(
        () => undefined,
        () => undefined
      );
      setError(t("invalidLogin"));
      setLoading(false);
      return;
    }

    // If this account enrolled 2FA, require the authenticator code (AAL2)
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp?.[0];
      if (totp) {
        setMfaFactorId(totp.id);
        setLoading(false);
        return;
      }
    }

    await finishLogin(supabase, data.user.id);
  }

  async function handleMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaFactorId) return;
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: mfaFactorId });
    if (chErr) {
      setError(chErr.message);
      setLoading(false);
      return;
    }
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId: mfaFactorId, challengeId: ch.id, code: mfaCode });
    if (vErr) {
      supabase.rpc("log_failed_login", { p_email: email }).then(
        () => undefined,
        () => undefined
      );
      setError(t("invalidLogin"));
      setLoading(false);
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) await finishLogin(supabase, userData.user.id);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo onDark size="lg" />
          <p className="text-brand-200 mt-3">{t("appTagline")}</p>
        </div>

        {mfaFactorId ? (
          <form onSubmit={handleMfa} className="card p-8 space-y-5">
            <div>
              <label className="block text-sm font-semibold mb-1.5">{t("enterCode")}</label>
              <input
                className="input text-center text-xl tracking-[0.4em]"
                dir="ltr"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>
            )}
            <button type="submit" className="btn-primary w-full" disabled={loading || mfaCode.length !== 6}>
              {t("verify2fa")}
            </button>
          </form>
        ) : (
        <form onSubmit={handleSubmit} className="card p-8 space-y-5">
          <div>
            <label className="block text-sm font-semibold mb-1.5">{t("email")}</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              dir="ltr"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1.5">{t("password")}</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              dir="ltr"
              autoComplete="current-password"
            />
          </div>
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
              {error}
            </div>
          )}
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? t("signingIn") : t("signIn")}
          </button>
          <button
            type="button"
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            className="w-full text-center text-sm text-slate-500 hover:text-brand-600 flex items-center justify-center gap-1.5"
          >
            <Globe className="w-4 h-4" />
            {lang === "ar" ? "English" : "العربية"}
          </button>
        </form>
        )}
      </div>
    </div>
  );
}
