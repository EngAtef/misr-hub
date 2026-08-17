"use client";

import { useState } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { PASSWORD_RULES } from "@/lib/password";
import { cn } from "@/lib/utils";

// Password input with a show/hide toggle and the four policy rules ticking
// off live underneath. Used wherever a password is set: new user, admin
// reset, the user's own change, and the forced first-login change.
export function PasswordField({
  value,
  onChange,
  required,
  autoFocus,
  placeholder,
  showRules = true,
  autoComplete = "new-password",
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  showRules?: boolean;
  autoComplete?: string;
}) {
  const { t } = useLang();
  const [show, setShow] = useState(false);
  return (
    <div>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          className="input pe-10"
          dir="ltr"
          required={required}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          className="absolute inset-y-0 end-2 flex items-center text-slate-400 hover:text-slate-600"
          aria-label={show ? t("pwHide") : t("pwShow")}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {showRules && (value.length > 0 || required) && (
        <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          {PASSWORD_RULES.map((r) => {
            const ok = r.test(value);
            return (
              <li
                key={r.key}
                className={cn("flex items-center gap-1.5 text-[11px]", ok ? "text-emerald-600" : "text-slate-400")}
              >
                {ok ? <Check size={12} /> : <X size={12} />}
                {t(r.key)}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
