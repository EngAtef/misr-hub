"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plug, Check, X, AlertTriangle, RefreshCw, Save, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import { cn, formatNumber } from "@/lib/utils";

interface AdAccount {
  id: string;
  account_id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
  business_name?: string;
}

interface MappedAccount {
  id: string;
  label: string;
  enabled: boolean;
}

interface TestResult {
  ok: boolean;
  graphVersion: string;
  token: {
    valid: boolean;
    type: string;
    appName?: string;
    neverExpires: boolean;
    expiresAt: string | null;
    scopes: string[];
    missingScopes: string[];
    optionalPresent: string[];
  };
  accounts: AdAccount[];
  accountsError?: string;
  resolvedById?: boolean;
  accountFailures?: { id: string; error: string }[];
  probe: { account: string; rows: number; actionTypes: string[]; sampleSpend: number } | null;
  probeError?: string;
  savedAccounts: MappedAccount[];
}

const T = {
  title: { ar: "اتصال Meta Ads", en: "Meta Ads connection" },
  intro: {
    ar: "بعد ما تحفظ التوكن فوق، اضغط «اختبار» — هنقولك التوكن شغال ولا لأ، إيه الصلاحيات الناقصة، وأنهي حسابات إعلانية شايفينها. بعدين اربط كل حساب باسمه في مركز الإعلانات.",
    en: "Once the token is saved above, press Test — it reports whether the token works, which permissions are missing, and every ad account it can see. Then map each account to the label the Ads Center already uses.",
  },
  test: { ar: "اختبار الاتصال", en: "Test connection" },
  testing: { ar: "جاري الاختبار...", en: "Testing..." },
  save: { ar: "حفظ الربط", en: "Save mapping" },
  saved: { ar: "تم الحفظ ✓", en: "Saved ✓" },
  tokenOk: { ar: "التوكن صالح", en: "Token valid" },
  tokenBad: { ar: "التوكن غير صالح", en: "Token invalid" },
  neverExpires: { ar: "لا ينتهي (System User) ✓", en: "Never expires (System User) ✓" },
  expires: { ar: "⚠ ينتهي في", en: "⚠ Expires" },
  expiresHint: {
    ar: "التوكن ده هينتهي — استخدم System User token عشان ميوقفش المزامنة فجأة.",
    en: "This token will expire — use a System User token so the sync doesn't stop without warning.",
  },
  scopes: { ar: "الصلاحيات", en: "Permissions" },
  missing: { ar: "ناقص", en: "Missing" },
  accounts: { ar: "الحسابات الإعلانية المتاحة", en: "Ad accounts visible to this token" },
  noAccounts: {
    ar: "التوكن شغال لكن مش شايف أي حساب إعلاني — لازم تضيف الحسابات للـ System User في Business Settings.",
    en: "The token works but sees no ad accounts — assign the accounts to the System User in Business Settings.",
  },
  byIdTitle: { ar: "أضف الحسابات بالـ ID", en: "Add accounts by ID" },
  byIdWhy: {
    ar: "سرد كل حسابات البزنس محتاج صلاحية business_management، لكن قراءة حساب معيّن محتاجة ads_read بس. فالصق الـ IDs هنا وهنجيبهم مباشرة — مش محتاج تزوّد صلاحيات التوكن.",
    en: "Listing every account in the business needs business_management, but reading a specific account needs only ads_read. Paste the IDs here and they'll be fetched directly — no need to widen the token's permissions.",
  },
  byIdWhere: {
    ar: "الـ IDs موجودة في Business Settings ← Ad accounts، أو في Ads Manager بعد act_",
    en: "Find the IDs in Business Settings → Ad accounts, or in Ads Manager after 'act_'",
  },
  byIdPlaceholder: {
    ar: "act_8042818365818373, 2112923705771276 … (فاصلة أو سطر جديد)",
    en: "act_8042818365818373, 2112923705771276 … (comma or newline separated)",
  },
  byIdCheck: { ar: "افحص الحسابات", en: "Check these accounts" },
  byIdResolved: {
    ar: "الحسابات دي اتجابت بالـ ID مباشرة (بدون business_management) ✓",
    en: "These were fetched directly by ID (no business_management needed) ✓",
  },
  byIdFailed: { ar: "IDs مش قدرنا نقراها", en: "Couldn't read these IDs" },
  orWiden: {
    ar: "أو: اعمل Generate token تاني وعلّم business_management كمان، وهيسردهم كلهم لوحده.",
    en: "Or: generate the token again with business_management ticked too, and it will list them all by itself.",
  },
  label: { ar: "الاسم في مركز الإعلانات", en: "Ads Center label" },
  labelHint: {
    ar: "خلّي الاسم مطابق للموجود دلوقتي (kids / culture / Disney) عشان البيانات الجديدة تكمّل على القديمة بدل ما تعمل حساب جديد.",
    en: "Match the labels you already have (kids / culture / Disney) so live data continues the existing history instead of creating a new account.",
  },
  include: { ar: "اسحب", en: "Pull" },
  readCheck: { ar: "قراءة الأداء", en: "Performance read" },
  readOk: { ar: "نجحت — قرأنا بيانات فعلية", en: "Works — real data returned" },
  readRows: { ar: "صف", en: "rows" },
  actionTypes: { ar: "أنواع التحويلات الموجودة في حسابك", en: "Conversion types your account actually reports" },
  actionTypesHint: {
    ar: "دي بتختلف حسب إعداد البيكسل — هنستخدمها في خطوة المزامنة عشان نطابق «المشتريات» صح.",
    en: "These vary by pixel setup — the sync step maps 'purchases' from these instead of guessing.",
  },
  statusActive: { ar: "نشط", en: "Active" },
  statusInactive: { ar: "غير نشط", en: "Inactive" },
  nextStep: {
    ar: "الاتصال شغال ✓ — الخطوة الجاية: سحب الإعلانات تلقائيًا وزر مزامنة في مركز الإعلانات.",
    en: "Connection works ✓ — next step: automatic ad pulling and a sync button in the Ads Center.",
  },
};

/**
 * The verification step for the Meta Marketing API. Everything here is a
 * read: it never changes anything in the ad account.
 */
export function MetaAdsConnection() {
  const { lang } = useLang();
  const tx = useCallback((v: { ar: string; en: string }) => v[lang], [lang]);
  const supabase = useMemo(() => createClient(), []);

  const [result, setResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ msg: string; hint?: string } | null>(null);
  const [mapping, setMapping] = useState<Record<string, MappedAccount>>({});
  const [savedFlash, setSavedFlash] = useState(false);
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [idsInput, setIdsInput] = useState("");

  useEffect(() => {
    supabase.rpc("fn_meta_ads_config").then(({ data }) => {
      const cfg = (data ?? {}) as { has_token?: boolean; accounts?: { accounts?: MappedAccount[] } };
      setHasToken(!!cfg.has_token);
      const saved = cfg.accounts?.accounts ?? [];
      setMapping(Object.fromEntries(saved.map((a) => [a.id, a])));
    });
  }, [supabase]);

  async function runTest(accountIds?: string[]) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/meta-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", ...(accountIds?.length ? { accountIds } : {}) }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError({ msg: j.error, hint: j.hint });
        setResult(null);
      } else {
        const r = j as TestResult;
        setResult(r);
        setHasToken(true);
        // pre-fill the label from the Meta account name, keeping any saved map
        setMapping((prev) => {
          const next = { ...prev };
          for (const a of r.accounts) {
            if (!next[a.id]) next[a.id] = { id: a.id, label: a.name, enabled: true };
          }
          return next;
        });
      }
    } catch (e) {
      setError({ msg: e instanceof Error ? e.message : "request failed" });
    }
    setBusy(false);
  }

  async function saveMapping() {
    setBusy(true);
    const res = await fetch("/api/meta-ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_accounts", accounts: Object.values(mapping) }),
    });
    setBusy(false);
    if (res.ok) {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    }
  }

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[260px] flex-1">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <Plug size={15} className="text-brand-600" />
            {tx(T.title)}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{tx(T.intro)}</p>
        </div>
        <button className="btn-primary" onClick={() => runTest()} disabled={busy}>
          <RefreshCw size={16} className={cn(busy && "animate-spin")} />
          {busy ? tx(T.testing) : tx(T.test)}
        </button>
      </div>

      {hasToken === false && !result && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {lang === "ar"
            ? "مفيش توكن محفوظ لسه — احفظ الـ System-User Access Token في كارت Meta فوق الأول."
            : "No token saved yet — save the System-User Access Token in the Meta card above first."}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <div className="font-semibold">{error.msg}</div>
          {error.hint && <div className="mt-1 text-xs opacity-80">{error.hint}</div>}
        </div>
      )}

      {result && (
        <div className="mt-5 space-y-5">
          {/* ---- token ---- */}
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold",
                  result.token.valid ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                )}
              >
                {result.token.valid ? <Check size={12} /> : <X size={12} />}
                {result.token.valid ? tx(T.tokenOk) : tx(T.tokenBad)}
              </span>
              <span className="text-xs text-slate-500">
                {result.token.type}
                {result.token.appName ? ` · ${result.token.appName}` : ""} · Graph {result.graphVersion}
              </span>
              <span
                className={cn(
                  "text-xs font-semibold",
                  result.token.neverExpires ? "text-emerald-600" : "text-amber-600"
                )}
              >
                {result.token.neverExpires
                  ? tx(T.neverExpires)
                  : `${tx(T.expires)} ${result.token.expiresAt?.slice(0, 10) ?? ""}`}
              </span>
            </div>
            {!result.token.neverExpires && <p className="mt-2 text-xs text-amber-700">{tx(T.expiresHint)}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500">{tx(T.scopes)}:</span>
              {result.token.scopes.map((s) => (
                <span key={s} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                  {s}
                </span>
              ))}
              {result.token.missingScopes.map((s) => (
                <span key={s} className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-red-700">
                  {tx(T.missing)}: {s}
                </span>
              ))}
            </div>
          </div>

          {/* ---- read proof ---- */}
          {(result.probe || result.probeError) && (
            <div
              className={cn(
                "rounded-xl border p-4",
                result.probe ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
              )}
            >
              <div className="text-sm font-bold text-slate-800">{tx(T.readCheck)}</div>
              {result.probe ? (
                <>
                  <div className="mt-1 text-xs text-emerald-800">
                    {tx(T.readOk)} — {formatNumber(result.probe.rows)} {tx(T.readRows)} ·{" "}
                    {formatNumber(result.probe.sampleSpend)} spend · {result.probe.account}
                  </div>
                  {result.probe.actionTypes.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs font-semibold text-slate-600">{tx(T.actionTypes)}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {result.probe.actionTypes.map((a) => (
                          <span key={a} className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                            {a}
                          </span>
                        ))}
                      </div>
                      <p className="mt-1.5 text-[11px] text-slate-500">{tx(T.actionTypesHint)}</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-1 text-xs text-red-700">{result.probeError}</div>
              )}
            </div>
          )}

          {/* ---- accounts ---- */}
          <div>
            <div className="mb-1 text-sm font-bold text-slate-800">{tx(T.accounts)}</div>
            <p className="mb-3 text-xs text-slate-500">{tx(T.labelHint)}</p>

            {result.accountsError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
                {result.accountsError}
              </div>
            )}

            {!result.accountsError && result.accounts.length === 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                {tx(T.noAccounts)}
              </div>
            )}

            {result.resolvedById && result.accounts.length > 0 && (
              <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-800">
                {tx(T.byIdResolved)}
              </div>
            )}

            {/* the listing endpoint needs a broader permission than reading an
                account does — so offer the narrower path rather than pushing
                the user to widen the token */}
            {result.accounts.length === 0 && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-bold text-slate-800">{tx(T.byIdTitle)}</div>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{tx(T.byIdWhy)}</p>
                <p className="mt-1 text-[11px] text-slate-500">{tx(T.byIdWhere)}</p>
                <textarea
                  className="input mt-2 h-20 w-full text-xs"
                  dir="ltr"
                  placeholder={tx(T.byIdPlaceholder)}
                  value={idsInput}
                  onChange={(e) => setIdsInput(e.target.value)}
                />
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button
                    className="btn-primary !py-1.5 text-xs"
                    disabled={busy || !idsInput.trim()}
                    onClick={() => runTest(idsInput.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))}
                  >
                    <RefreshCw size={14} className={cn(busy && "animate-spin")} />
                    {tx(T.byIdCheck)}
                  </button>
                  <span className="text-[11px] text-slate-500">{tx(T.orWiden)}</span>
                </div>
                {(result.accountFailures?.length ?? 0) > 0 && (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800">
                    <div className="font-bold">{tx(T.byIdFailed)}</div>
                    {result.accountFailures!.map((f) => (
                      <div key={f.id} dir="ltr" className="mt-0.5">
                        {f.id}: {f.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {result.accounts.length > 0 && (
              <>
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>{tx(T.include)}</th>
                        <th>Meta</th>
                        <th>{tx(T.label)}</th>
                        <th>ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.accounts.map((a) => {
                        const m = mapping[a.id] ?? { id: a.id, label: a.name, enabled: true };
                        return (
                          <tr key={a.id}>
                            <td>
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-brand-600"
                                checked={m.enabled}
                                onChange={(e) => setMapping({ ...mapping, [a.id]: { ...m, enabled: e.target.checked } })}
                              />
                            </td>
                            <td className="!whitespace-normal max-w-[220px]">
                              <div className="font-medium">{a.name}</div>
                              <div className="text-[11px] text-slate-400">
                                {a.business_name ? `${a.business_name} · ` : ""}
                                {a.currency} · {a.timezone_name}
                                <span className={cn("ms-1 font-semibold", a.account_status === 1 ? "text-emerald-600" : "text-amber-600")}>
                                  {a.account_status === 1 ? tx(T.statusActive) : tx(T.statusInactive)}
                                </span>
                              </div>
                            </td>
                            <td>
                              <input
                                className="input !py-1 w-40 text-xs"
                                value={m.label}
                                onChange={(e) => setMapping({ ...mapping, [a.id]: { ...m, label: e.target.value } })}
                              />
                            </td>
                            <td className="font-mono text-[11px] text-slate-400" dir="ltr">
                              {a.id}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <button className="btn-primary" onClick={saveMapping} disabled={busy}>
                    <Save size={16} />
                    {savedFlash ? tx(T.saved) : tx(T.save)}
                  </button>
                  <a
                    href="https://business.facebook.com/settings/system-users"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
                  >
                    Business Settings <ExternalLink size={11} />
                  </a>
                </div>
              </>
            )}
          </div>

          {result.ok && result.probe && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
              {tx(T.nextStep)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
