/**
 * Chiffrement authentifié AES-256-GCM pour les secrets d'intégration.
 * La clé provient exclusivement d'une variable d'environnement serveur
 * (IXELLIO_ENCRYPTION_KEY) : elle n'est jamais stockée en base ni exposée.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function key(): Buffer {
  const secret = process.env["IXELLIO_ENCRYPTION_KEY"];
  if (!secret) throw new Error("Clé de chiffrement serveur absente (IXELLIO_ENCRYPTION_KEY).");
  return createHash("sha256").update(secret).digest();
}

/** Retourne `iv.tag.ciphertext` en base64url, IV aléatoire par valeur. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Secret chiffré illisible.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
}
