// Password policy — mirrors public.is_strong_password() in migration 105.
// 8+ characters, one capital letter, one number, one special character.

export const PASSWORD_RULES = [
  { key: "pwRuleLength", test: (p: string) => p.length >= 8 },
  { key: "pwRuleUpper", test: (p: string) => /[A-Z]/.test(p) },
  { key: "pwRuleDigit", test: (p: string) => /[0-9]/.test(p) },
  { key: "pwRuleSpecial", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
] as const;

export function isStrongPassword(p: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(p));
}
