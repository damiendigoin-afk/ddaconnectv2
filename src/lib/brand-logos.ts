/**
 * Logos officiels de marque pour le PDF commercial (chargés localement, jamais redessinés).
 *
 * ÉTAT 01/11/2026 : les PNG Renault (120 px) et Dacia (240 px) transmis en base64 sont TRONQUÉS
 * (chunk IDAT déclaré 4 648 o / 1 327 o, seulement 3 604 o / 1 297 o présents, pas de IEND) :
 * refusés par isCompletePng, donc NON intégrés. Le PDF reste sans logo de marque, avec l'identité texte.
 * Pour les activer : coller ici le base64 COMPLET de chaque PNG (une ligne), puis lancer les tests.
 */
export const RENAULT_LOGO_PNG_B64: string | null = null;
export const DACIA_LOGO_PNG_B64: string | null = null;

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

/** PNG structurellement complet : signature, IHDR en tête, chunks dans les bornes, IEND final. */
export function isCompletePng(b: Uint8Array | null | undefined): boolean {
  if (!b || b.length < 8 + 25 + 12 || !SIG.every((v, i) => b[i] === v)) return false;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 8, first = true;
  while (i + 12 <= b.length) {
    const n = dv.getUint32(i);
    const t = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    if (first && t !== "IHDR") return false;
    first = false;
    if (i + 12 + n > b.length) return false;
    if (t === "IEND") return i + 12 + n === b.length;
    i += 12 + n;
  }
  return false;
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Logos validés, sinon null (jamais d'image partielle ni de substitut). */
export function officialBrandLogos(): { renault: Uint8Array | null; dacia: Uint8Array | null } {
  const load = (s: string | null) => {
    if (!s) return null;
    try { const b = b64ToBytes(s); return isCompletePng(b) ? b : null; } catch { return null; }
  };
  return { renault: load(RENAULT_LOGO_PNG_B64), dacia: load(DACIA_LOGO_PNG_B64) };
}
