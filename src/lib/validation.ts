/** Validation d'adresse e-mail « suffisamment stricte » pour l'atelier. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

export function isValidEmail(value: string | null | undefined): boolean {
  return !!value && EMAIL_RE.test(value.trim());
}

export function emailHint(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  return isValidEmail(v) ? null : "Adresse email probablement invalide";
}
