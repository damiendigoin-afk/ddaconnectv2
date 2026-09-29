/**
 * Identification du fournisseur d'un document importé (commande, BL, facture) — logique pure, testable.
 * Normalisation : casse, accents, ponctuation, espaces. Jamais de création si plusieurs fiches proches.
 */
import type { InvoiceExtract, SupplierInfo } from "@/lib/supplier-docs";

export const normSupplierName = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const STOP = new Set(["sa", "sas", "sarl", "eurl", "snc", "ste", "societe", "ets", "etablissements", "et", "de", "des", "du", "la", "le", "les", "groupe", "sasu"]);
const sig = (s: string) => normSupplierName(s).split(" ").filter((w) => w.length >= 3 && !STOP.has(w));

type S = { id: string; name: string; active?: boolean | null; notes?: string | null };

/**
 * Enseignes / alias d'une fiche, déclarés dans ses notes (une ligne « Alias : A ; B » ou « Enseigne : … »).
 * Mécanisme général : raison sociale ≠ enseigne commerciale (ex. OSKARBI AUTO SL = Pièce Auto Discount).
 */
export function supplierAliases(notes: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (notes ?? "").matchAll(/^\s*(?:alias|enseigne|nom commercial|raison sociale)\s*:\s*(.+)$/gim)) {
    for (const a of m[1]!.split(/[;|,]/)) if (normSupplierName(a).length >= 3) out.push(a.trim());
  }
  return out;
}

/** Identifiants fiscaux déclarés dans les notes (TVA intracom, SIRET/SIREN), normalisés. */
export function supplierIds(notes: string | null | undefined): string[] {
  return [...(notes ?? "").matchAll(/(?:tva(?: intracom)?|siret(?:\/siren)?|siren)\s*:\s*([A-Z0-9 ]{8,20})/gi)].map((m) => m[1]!.replace(/\s/g, "").toUpperCase());
}

/** Tous les noms d'une fiche : nom + alias. */
export const supplierNames = (s: { name: string; notes?: string | null }) => [s.name, ...supplierAliases(s.notes)];

/** Ajoute un alias à des notes existantes (idempotent). */
export function withAlias(notes: string | null | undefined, alias: string): string {
  const n = normSupplierName(alias);
  const cur = notes ?? "";
  if (n.length < 3 || supplierAliases(cur).some((a) => normSupplierName(a) === n)) return cur;
  return [cur.trim(), `Alias : ${alias.trim().toUpperCase()}`].filter(Boolean).join("\n");
}

export type SupplierResolution<T extends S = S> =
  | { kind: "none" }
  | { kind: "found"; supplier: T }
  | { kind: "ambiguous"; candidates: T[] }
  | { kind: "new"; name: string };

export function resolveSupplier<T extends S>(name: string | null | undefined, suppliers: T[], ids: (string | null | undefined)[] = []): SupplierResolution<T> {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  const n = normSupplierName(clean);
  // Identifiant fiscal lu = fiche portant ce même identifiant (le plus sûr).
  const idKeys = ids.map((v) => (v ?? "").replace(/\s/g, "").toUpperCase()).filter((v) => v.length >= 8);
  if (idKeys.length) {
    const byId = suppliers.filter((s) => supplierIds(s.notes).some((k) => idKeys.includes(k)));
    if (byId.length === 1) return { kind: "found", supplier: byId[0]! };
  }
  if (n.length < 3) return { kind: "none" };
  const pool = suppliers.filter((s) => normSupplierName(s.name).length >= 3);
  const names = (s: T) => supplierNames(s).map(normSupplierName);
  const exact = pool.filter((s) => names(s).includes(n));
  if (exact.length) return { kind: "found", supplier: exact.find((s) => s.active !== false) ?? exact[0]! };
  const active = pool.filter((s) => s.active !== false);
  const contains = active.filter((s) => names(s).some((sn) => sn.length >= 3 && (n.includes(sn) || sn.includes(n))));
  if (contains.length === 1) return { kind: "found", supplier: contains[0]! };
  if (contains.length > 1) return { kind: "ambiguous", candidates: contains };
  // Mots significatifs : tous ceux de la fiche présents dans le nom lu (ordre indifférent).
  const words = new Set(sig(clean));
  const full = active.filter((s) => { const sw = sig(s.name); return sw.length > 0 && sw.every((w) => words.has(w)); });
  if (full.length === 1) return { kind: "found", supplier: full[0]! };
  if (full.length > 1) return { kind: "ambiguous", candidates: full };
  return { kind: "new", name: clean.toUpperCase() };
}

export type SupplierDraft = { name: string; address: string; postal_code: string; city: string; phone: string; email: string; website: string; siret: string; vat_number: string };

const s = (v: unknown) => (v == null ? "" : String(v).trim());

/** Fiche préremplie avec tout ce qui a été lu sur le document ; rien n'est inventé. */
export function supplierDraftFromExtract(x: InvoiceExtract): SupplierDraft {
  const i: SupplierInfo = x.supplier_info ?? {};
  const cp = s(i.postal_code).replace(/\D/g, "");
  return {
    name: s(x.supplier).replace(/\s+/g, " ").toUpperCase(),
    address: s(i.address),
    postal_code: cp.length === 5 ? cp : "",
    city: s(i.city).toUpperCase(),
    phone: s(i.phone),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s(i.email)) ? s(i.email).toLowerCase() : "",
    website: s(i.website),
    siret: s(i.siret).replace(/\s/g, ""),
    vat_number: s(i.vat_number).replace(/\s/g, "").toUpperCase(),
  };
}

/** Colonnes `suppliers` ; SIRET / TVA (sans colonne dédiée) sont conservés dans les notes. */
export function draftToSupplierRow(d: SupplierDraft) {
  const notes = [d.siret ? `SIRET/SIREN : ${d.siret}` : "", d.vat_number ? `TVA intracom : ${d.vat_number}` : ""].filter(Boolean).join("\n");
  const nz = (v: string) => v.trim() || null;
  return { name: d.name.trim().toUpperCase(), address: nz(d.address), postal_code: nz(d.postal_code), city: nz(d.city), phone: nz(d.phone), email: nz(d.email), website: nz(d.website), notes: notes || null };
}

/** Fournisseur effectif d'un document : rattachement explicite d'abord, sinon correspondance sûre. */
export function docSupplierId<T extends S>(x: InvoiceExtract, suppliers: T[]): string | null {
  if (x.supplier_id && suppliers.some((s) => s.id === x.supplier_id)) return x.supplier_id;
  const r = resolveSupplier(x.supplier, suppliers, [x.supplier_info?.vat_number, x.supplier_info?.siret]);
  return r.kind === "found" ? r.supplier.id : null;
}
