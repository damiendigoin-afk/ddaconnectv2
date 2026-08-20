/**
 * URL publique canonique utilisée dans tous les e-mails sortants.
 * Jamais l'origine du poste utilisateur (localhost, IP locale, preview Lovable).
 */
const FALLBACK_PUBLIC_URL = "https://ddaconnectv2.lovable.app";

const BLOCKED = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  ".local",
  "id-preview--",
  "-dev.lovable.app",
  "lovableproject.com",
  "lovable.dev",
];

/** Origine publique configurée côté serveur (domaine custom possible). */
export function publicOrigin(candidate?: string | null): string {
  const configured =
    process.env["PUBLIC_APP_URL"] ||
    process.env["VITE_PUBLIC_APP_URL"] ||
    FALLBACK_PUBLIC_URL;

  const pick = (value?: string | null): string | null => {
    if (!value) return null;
    let host: string;
    try {
      const u = new URL(value);
      if (u.protocol !== "https:") return null;
      host = u.hostname.toLowerCase();
      if (BLOCKED.some((b) => host.includes(b))) return null;
      return `${u.origin}`.replace(/\/$/, "");
    } catch {
      return null;
    }
  };

  return pick(configured) ?? pick(candidate) ?? FALLBACK_PUBLIC_URL;
}