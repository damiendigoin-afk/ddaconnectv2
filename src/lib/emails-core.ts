/** Logique pure du module Flux emails : catégorisation et anti-doublons. */

export const EMAIL_CATEGORIES = [
  "atelier",
  "carrosserie",
  "magasin",
  "vn_vo",
  "devis",
  "rendez_vous",
  "client",
  "assurance",
  "expert",
  "fournisseur",
  "bl",
  "comptabilite",
  "rh",
  "administratif",
  "renault",
  "direction",
  "publicite",
  "autre",
] as const;

export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<EmailCategory, string> = {
  atelier: "Atelier mécanique",
  carrosserie: "Carrosserie",
  magasin: "Magasin",
  vn_vo: "Vente véhicules",
  devis: "Devis",
  rendez_vous: "Demande de rendez-vous",
  client: "Client",
  assurance: "Assurance",
  expert: "Expert",
  fournisseur: "Fournisseur",
  bl: "Bon de livraison",
  comptabilite: "Comptabilité",
  rh: "RH",
  administratif: "Administratif",
  renault: "Renault",
  direction: "Direction",
  publicite: "Publicité",
  autre: "À classer",
};

/** Affectations proposées en un clic sur chaque e-mail du flux (tri manuel rapide). */
export const QUICK_CATEGORIES: EmailCategory[] = [
  "atelier",
  "carrosserie",
  "magasin",
  "vn_vo",
  "comptabilite",
  "rh",
  "direction",
  "publicite",
  "autre",
];

const RULES: { cat: EmailCategory; words: string[]; weight: number }[] = [
  { cat: "renault", words: ["renault", "dacia", "alpine", "reagroup"], weight: 0.9 },
  { cat: "expert", words: ["expert", "expertise", "darva", "sidexa", "gta", "rapport d'expertise"], weight: 0.9 },
  { cat: "assurance", words: ["assurance", "sinistre", "assureur", "macif", "maif", "axa", "groupama", "allianz", "mutuelle"], weight: 0.85 },
  { cat: "carrosserie", words: ["carrosserie", "peinture", "grele", "grêle", "vge", "choc", "pare-choc", "tolerie", "tôlerie"], weight: 0.85 },
  { cat: "bl", words: ["bon de livraison", "bl n", "livraison pièces", "colis", "expedition", "expédition"], weight: 0.8 },
  { cat: "fournisseur", words: ["fournisseur", "commande pièces", "commande piece", "facture fournisseur", "tarif", "disponibilite piece"], weight: 0.75 },
  { cat: "devis", words: ["devis", "estimation", "chiffrage", "proposition commerciale"], weight: 0.8 },
  { cat: "rendez_vous", words: ["rendez-vous", "rdv", "prise de rdv", "disponibilite atelier", "créneau", "creneau"], weight: 0.8 },
  { cat: "comptabilite", words: ["comptab", "facture", "règlement", "reglement", "relance", "impayé", "impaye", "virement", "avoir"], weight: 0.7 },
  { cat: "publicite", words: ["newsletter", "promotion", "offre du mois", "se désinscrire", "se desinscrire", "désinscription", "desinscription", "publicité", "publicite", "ne plus recevoir", "nos offres", "portes ouvertes", "mailing"], weight: 0.9 },
  { cat: "magasin", words: ["magasin", "retour fournisseur", "pièce en retour", "piece en retour", "stock pièces", "stock pieces", "avoir pièces", "avoir pieces"], weight: 0.8 },
  { cat: "direction", words: ["direction", "comité", "comite", "réunion de direction", "reunion de direction", "concession", "groupement"], weight: 0.6 },
  { cat: "rh", words: ["contrat de travail", "paie", "congés", "conges", "absence", "candidature", "cv "], weight: 0.8 },
  { cat: "vn_vo", words: ["véhicule neuf", "vehicule neuf", "occasion", "vo ", "vn ", "reprise", "lead", "annonce", "leboncoin", "lacentrale"], weight: 0.75 },
  { cat: "atelier", words: ["révision", "revision", "vidange", "distribution", "embrayage", "frein", "diagnostic", "atelier", "or n"], weight: 0.7 },
  { cat: "administratif", words: ["urssaf", "impots", "impôts", "prefecture", "préfecture", "attestation", "administratif"], weight: 0.7 },
  { cat: "client", words: ["bonjour, je", "ma voiture", "mon véhicule", "mon vehicule", "réclamation", "reclamation"], weight: 0.6 },
];

export function categorizeEmail(input: { subject?: string | null | undefined; body?: string | null | undefined; from?: string | null | undefined }): {
  category: EmailCategory;
  confidence: number;
} {
  const hay = `${input.subject ?? ""} ${input.from ?? ""} ${(input.body ?? "").slice(0, 4000)}`.toLowerCase();
  let best: { cat: EmailCategory; score: number } = { cat: "autre", score: 0 };
  for (const rule of RULES) {
    const hits = rule.words.filter((w) => hay.includes(w)).length;
    if (!hits) continue;
    const score = Math.min(0.98, rule.weight * (1 + (hits - 1) * 0.1));
    if (score > best.score) best = { cat: rule.cat, score };
  }
  return best.score ? { category: best.cat, confidence: Number(best.score.toFixed(2)) } : { category: "autre", confidence: 0 };
}

export function normalizeSubject(subject: string | null | undefined): string {
  return (subject ?? "")
    .toLowerCase()
    .replace(/^(\s*(re|ré|rép|rep|fwd|tr|fw)\s*:\s*)+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Type de message : distingue un vrai doublon d'un transfert / d'une réponse. */
export function messageKind(subject: string | null | undefined): "message" | "reponse" | "transfert" {
  const s = (subject ?? "").toLowerCase().trim();
  if (/^(fwd|fw|tr)\s*:/.test(s)) return "transfert";
  if (/^(re|ré|rep|rép)\s*:/.test(s)) return "reponse";
  return "message";
}

function hash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c + i, 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * Empreinte anti-doublons.
 * Un même email redirigé vers plusieurs boîtes produit la même empreinte,
 * alors qu'un transfert, une réponse ou un nouveau message du fil en produisent une différente.
 */
export function emailFingerprint(input: {
  rfcMessageId?: string | null;
  from: string;
  subject?: string | null;
  sentAt: string;
  body?: string | null;
}): string {
  if (input.rfcMessageId && input.rfcMessageId.trim()) return `mid:${input.rfcMessageId.trim().toLowerCase()}`;
  const minute = new Date(input.sentAt);
  minute.setSeconds(0, 0);
  const bodyKey = (input.body ?? "").replace(/\s+/g, " ").trim().slice(0, 800).toLowerCase();
  const kind = messageKind(input.subject);
  return `h:${hash(
    [input.from.toLowerCase().trim(), normalizeSubject(input.subject), kind, minute.toISOString(), bodyKey].join("|"),
  )}`;
}

export function threadKeyOf(input: { gmailThreadId?: string | null | undefined; subject?: string | null | undefined; from: string }): string {
  if (input.gmailThreadId) return `g:${input.gmailThreadId}`;
  return `s:${hash(normalizeSubject(input.subject) + "|" + input.from.toLowerCase().trim())}`;
}


/* ------------------------- Règles de tri déterministes ------------------------ */

export type EmailRule = {
  id: string;
  match_type: "sender" | "domain" | "subject";
  match_value: string;
  category: string;
};

/**
 * Applique les règles de tri enregistrées : adresse exacte d'abord,
 * puis domaine, puis mot de l'objet. Aucune IA.
 */
export function matchEmailRule(
  rules: EmailRule[],
  email: { from?: string | null | undefined; subject?: string | null | undefined },
): EmailRule | null {
  const from = (email.from ?? "").toLowerCase().trim();
  const domain = from.includes("@") ? from.split("@")[1]! : "";
  const subject = (email.subject ?? "").toLowerCase();
  const by = (t: EmailRule["match_type"]) => rules.filter((r) => r.match_type === t);
  return (
    by("sender").find((r) => r.match_value.toLowerCase().trim() === from) ??
    by("domain").find((r) => r.match_value.toLowerCase().replace(/^@/, "").trim() === domain) ??
    by("subject").find((r) => r.match_value.trim().length > 2 && subject.includes(r.match_value.toLowerCase().trim())) ??
    null
  );
}

/* --------------------- Détection d'immatriculation (regex) -------------------- */

const PLATE_NEW = /\b([A-Z]{2})[\s-]?(\d{3})[\s-]?([A-Z]{2})\b/g;
const PLATE_OLD = /\b(\d{2,4})[\s-]?([A-Z]{2,3})[\s-]?(\d{2})\b/g;

/** Immatriculations françaises trouvées dans un texte, normalisées et dédoublonnées. */
export function findPlates(text: string | null | undefined): string[] {
  const hay = (text ?? "").toUpperCase();
  const out = new Set<string>();
  for (const re of [PLATE_NEW, PLATE_OLD]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(hay))) {
      const plate = `${m[1]}${m[2]}${m[3]}`;
      // Écarte les faux positifs évidents (SS, WW, dates collées).
      if (/^\d/.test(plate) && plate.length < 6) continue;
      out.add(plate);
    }
  }
  return [...out];
}
