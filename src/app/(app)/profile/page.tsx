"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ShieldCheck, ShieldOff, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { PageHeader, Spinner } from "@/components/ui";

export default function ProfilePage() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [uid, setUid] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUid(user.id);
      setEmail(user.email ?? "");
      const { data } = await supabase.from("profiles").select("full_name, phone, avatar_url").eq("id", user.id).single();
      if (data) {
        setFullName(data.full_name ?? "");
        setPhone(data.phone ?? "");
        setAvatar(data.avatar_url ?? null);
      }
      setLoading(false);
    })();
  }, [supabase]);

  // resize the chosen image to a small data URL — no storage bucket needed
  async function handlePhoto(file: File) {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const size = 160;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        setAvatar(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    await supabase.from("profiles").update({ full_name: fullName, phone, avatar_url: avatar, updated_at: new Date().toISOString() }).eq("id", uid);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) return <div><PageHeader title={t("profile")} /><Spinner /></div>;

  return (
    <div className="max-w-2xl">
      <PageHeader title={t("profile")} />

      <div className="card p-6 space-y-5">
        <div className="flex items-center gap-4">
          <div className="relative">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" className="h-20 w-20 rounded-full object-cover border-2 border-brand-100" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-50 text-brand-400">
                <User size={32} />
              </div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1 -end-1 rounded-full bg-brand-600 p-1.5 text-white shadow hover:bg-brand-700"
              title={t("changePhoto")}
            >
              <Camera size={14} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handlePhoto(f);
              }}
            />
          </div>
          <div>
            <div className="font-bold">{fullName || email}</div>
            <div className="text-xs text-slate-500" dir="ltr">{email}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{t("photoHint")}</div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">{t("fullName")}</label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">{t("phoneNumber")}</label>
          <input className="input" dir="ltr" placeholder="+2010..." value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>

        <button className="btn-primary" onClick={save} disabled={saving}>
          {saved ? t("profileSaved") : t("saveProfile")}
        </button>
      </div>

      <TwoFactorSection />
    </div>
  );
}

function TwoFactorSection() {
  const { t } = useLang();
  const supabase = useMemo(() => createClient(), []);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [qr, setQr] = useState("");
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setEnabled(!!data?.totp?.length);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startEnroll() {
    setError("");
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `NM ${Date.now()}` });
    if (error) {
      setError(error.message);
      return;
    }
    setQr(data.totp.qr_code);
    setFactorId(data.id);
    setEnrolling(true);
  }

  async function verify() {
    setError("");
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
    if (chErr) {
      setError(chErr.message);
      return;
    }
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code });
    if (error) {
      setError(error.message);
      return;
    }
    setEnrolling(false);
    setCode("");
    refresh();
  }

  async function disable() {
    const { data } = await supabase.auth.mfa.listFactors();
    for (const f of data?.totp ?? []) await supabase.auth.mfa.unenroll({ factorId: f.id });
    refresh();
  }

  return (
    <div className="card p-6 mt-6 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={18} className="text-brand-600" />
        <h3 className="font-bold">{t("twoFactor")}</h3>
      </div>
      <p className="text-xs text-slate-500">{t("twoFactorHint")}</p>

      {enabled === null ? (
        <Spinner />
      ) : enabled ? (
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
            <ShieldCheck size={15} /> {t("twoFaOn")}
          </span>
          <button className="btn-secondary text-red-600" onClick={disable}>
            <ShieldOff size={15} /> {t("disable2fa")}
          </button>
        </div>
      ) : enrolling ? (
        <div className="space-y-3">
          <p className="text-sm">{t("scanQr")}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="2FA QR" className="rounded-lg border border-slate-200" width={180} height={180} />
          <input
            className="input max-w-[200px]"
            dir="ltr"
            inputMode="numeric"
            placeholder={t("enterCode")}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <div>
            <button className="btn-primary" onClick={verify}>{t("verify2fa")}</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">{t("twoFaOff")}</span>
          <button className="btn-primary" onClick={startEnroll}>
            <ShieldCheck size={15} /> {t("enable2fa")}
          </button>
        </div>
      )}
      {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
    </div>
  );
}
