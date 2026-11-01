/**
 * Vérification d'un id_token Google Identity côté serveur (WebCrypto, RS256).
 * Contrôles : signature (JWKS Google), iss, aud = clientId configuré, exp,
 * email_verified. Ne retourne que nom et e-mail. Ne donne AUCUN droit staff.
 */
export type GoogleJwk = { kid: string; kty: "RSA"; n: string; e: string; alg?: string };
export type GoogleIdentity = { email: string; name: string | null };

const ISS = new Set(["accounts.google.com", "https://accounts.google.com"]);
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export async function verifyGoogleIdToken(
  token: string,
  opts: { clientId: string; now: Date; getKeys: () => Promise<GoogleJwk[]> },
): Promise<{ ok: true; identity: GoogleIdentity } | { ok: false; reason: string }> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]!)));
    claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]!)));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (header.alg !== "RS256" || !header.kid) return { ok: false, reason: "alg" };
  const jwk = (await opts.getKeys()).find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: "unknown_key" };
  const key = await crypto.subtle.importKey(
    "jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]!), new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) return { ok: false, reason: "signature" };
  if (!ISS.has(String(claims['iss']))) return { ok: false, reason: "iss" };
  const aud = claims['aud'];
  if (!(aud === opts.clientId || (Array.isArray(aud) && aud.includes(opts.clientId)))) return { ok: false, reason: "aud" };
  if (typeof claims['exp'] !== "number" || claims['exp'] * 1000 <= opts.now.getTime()) return { ok: false, reason: "expired" };
  if (claims['email_verified'] !== true || typeof claims['email'] !== "string") return { ok: false, reason: "email_unverified" };
  return { ok: true, identity: { email: claims['email'].toLowerCase(), name: typeof claims['name'] === "string" ? claims['name'].slice(0, 100) : null } };
}

export async function fetchGoogleKeys(): Promise<GoogleJwk[]> {
  const r = await fetch(GOOGLE_JWKS_URL);
  if (!r.ok) throw new Error("jwks");
  return ((await r.json()) as { keys: GoogleJwk[] }).keys;
}
