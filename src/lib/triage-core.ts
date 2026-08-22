/**
 * Qualification métier d'une information entrante (cahier des charges V0.2, §1 à §29).
 *
 * Trois axes DISTINCTS : importance, urgence, action requise.
 * S'y ajoutent : intervention humaine requise, services concernés, échéance cible,
 * durée de vie (info temporaire) et niveau de confiance.
 *
 * Cette logique est volontairement pure et déterministe : elle propose, elle ne décide pas.
 * En cas de doute, elle renvoie `a_qualifier` + confiance faible : rien n'est marqué traité
 * automatiquement et aucune valeur métier n'est inventée.
 */

export type Importance = "faible" | "normale" | "forte";
export type Urgency = "aucune" | "faible" | "moyenne" | "haute" | "immediate";
export type Confidence = "faible" | "moyenne" | "forte";
export type TriageStatus = "a_qualifier" | "a_traiter" | "en_cours" | "traite" | "sans_suite";

export const IMPORTANCE_LABELS: Record<Importance, string> = {
  faible: "Importance faible",
  normale: "Importance normale",
  forte: "Importance forte",
};

export const URGENCY_LABELS: Record<Urgency, string> = {
  aucune: "Pas d'urgence",
  faible: "Urgence faible",
  moyenne: "Urgence moyenne",
  haute: "Urgence haute",
  immediate: "Urgence immédiate",
};

export const TRIAGE_STATUS_LABELS: Record<TriageStatus, string> = {
  a_qualifier: "À qualifier",
  a_traiter: "À traiter",
  en_cours: "En cours",
  traite: "Traité",
  sans_suite: "Sans suite",
};

/** Services / audiences pouvant être concernés — un contexte unique, plusieurs rattachements (§3). */
export const SERVICES = [
  "atelier",
  "carrosserie",
  "vente_vo",
  "vente_vn",
  "compta",
  "tresorerie",
  "admin",
  "rh",
  "secretariat_vo",
  "direction",
  "perso",
] as const;
export type Service = (typeof SERVICES)[number];

export const SERVICE_LABELS: Record<Service, string> = {
  atelier: "Atelier",
  carrosserie: "Carrosserie",
  vente_vo: "Vente VO",
  vente_vn: "Vente VN",
  compta: "Comptabilité",
  tresorerie: "Trésorerie",
  admin: "Administratif",
  rh: "RH",
  secretariat_vo: "Secrétariat VO",
  direction: "Direction",
  perso: "Personnel",
};

export type Triage = {
  importance: Importance;
  urgency: Urgency;
  actionRequired: boolean;
  /** Le sujet reste ouvert tant qu'un humain n'a pas validé / agi (§4). */
  humanRequired: boolean;
  services: Service[];
  /** Délai cible en minutes à partir de la réception (§25). `null` = pas de délai. */
  dueInMinutes: number | null;
  /** Durée de vie d'une info temporaire en jours (§5, §9). `null` = pas d'expiration. */
  expiresInDays: number | null;
  confidence: Confidence;
  status: TriageStatus;
  reason: string;
};

const MIN = 1;
const HOUR = 60;
const DAY = 24 * HOUR;

type Rule = {
  id: string;
  /** Motifs recherchés dans objet + expéditeur + corps (normalisés). */
  any: string[];
  /** Motifs supplémentaires obligatoires (tous requis) — sécurise les cas ambigus. */
  all?: string[];
  triage: Omit<Triage, "reason"> & { reason?: string };
  reason: string;
};

/**
 * Règles issues des cas métier validés (§6 à §24).
 * Aucun barème inventé : seuls trois délais explicitement validés sont appliqués
 * (prospect VO < 1 h, suivi commercial J+1, partenariat J+7). Partout ailleurs,
 * seule l'urgence qualitative est posée et `due_at` / `expires_at` restent nuls
 * tant qu'aucune date réelle n'est extraite ou paramétrée.
 */
const RULES: Rule[] = [
  {
    // §12 — prospect VO appel manqué (Leboncoin / La Centrale) : rappel < 1h
    id: "prospect_vo",
    any: ["leboncoin", "le bon coin", "appel manqué", "appel manque", "lacentrale", "la centrale", "nouveau contact", "demande d'information annonce"],
    triage: {
      importance: "forte",
      urgency: "immediate",
      actionRequired: true,
      humanRequired: true,
      services: ["vente_vo"],
      dueInMinutes: 60 * MIN,
      expiresInDays: null,
      confidence: "moyenne",
      status: "a_traiter",
    },
    reason: "Prospect VO entrant : rappel cible sous 1 h, rattachement au véhicule de l'annonce si identifié.",
  },
  {
    // §11 — facturation électronique réglementaire
    id: "facturation_electronique",
    any: ["facturation électronique", "facturation electronique", "facture électronique", "e-invoicing", "chorus pro", "pdp ", "plateforme de dématérialisation"],
    triage: {
      importance: "forte",
      urgency: "moyenne",
      actionRequired: true,
      humanRequired: true,
      services: ["admin", "compta"],
      dueInMinutes: null,
      expiresInDays: null,
      confidence: "moyenne",
      status: "a_traiter",
    },
    reason: "Conformité facturation électronique : action obligatoire. Échéance renseignée uniquement si une date réelle est extraite du message ou paramétrée.",
  },
  {
    // §17 / §23 — carrosserie ou VO avec règlement / facturation bloqué
    id: "reglement_bloque",
    any: ["règlement bloqué", "reglement bloque", "facturation bloquée", "facturation bloquee", "liasse manquante", "pièces manquantes dossier", "relance règlement", "relance reglement", "impayé", "impaye"],
    triage: {
      importance: "forte",
      urgency: "moyenne",
      actionRequired: true,
      humanRequired: true,
      services: ["compta", "vente_vo", "carrosserie"],
      dueInMinutes: null,
      expiresInDays: null,
      confidence: "moyenne",
      status: "a_traiter",
    },
    reason: "Dossier bloqué en facturation / règlement : reste ouvert jusqu'à régularisation humaine, sans échéance arbitraire.",
  },
  {
    // §20 / §21 — bon de commande achat VO
    id: "achat_vo",
    any: ["bon de commande", "bdc", "bon d'achat véhicule", "achat véhicule", "achat vehicule"],
    triage: {
      importance: "forte",
      urgency: "moyenne",
      actionRequired: true,
      humanRequired: true,
      services: ["vente_vo", "compta", "tresorerie", "secretariat_vo"],
      dueInMinutes: null,
      expiresInDays: null,
      confidence: "moyenne",
      status: "a_traiter",
    },
    reason: "Commande / achat VO : rechercher le véhicule avant toute création, préparer le suivi achat et trésorerie.",
  },
  {
    // §16 — carrosserie / assurance / expertise
    id: "sinistre",
    any: ["sinistre", "expertise", "rapport d'expertise", "assureur", "darva", "constat"],
    triage: {
      importance: "forte",
      urgency: "moyenne",
      actionRequired: true,
      humanRequired: true,
      services: ["carrosserie"],
      dueInMinutes: null,
      expiresInDays: null,
      confidence: "moyenne",
      status: "a_traiter",
    },
    reason: "Dossier sinistre / expertise : rattacher au dossier existant, décision métier humaine requise.",
  },
  {
    // §15 — suivi OR / véhicule prêt
    id: "suivi_or",
    any: ["véhicule prêt", "vehicule pret", "suivi de mon or", "où en est", "ou en est ma voiture", "restitution", "récupérer mon véhicule", "recuperer mon vehicule"],
    triage: {
      importance: "normale",
      urgency: "haute",
      actionRequired: true,
      humanRequired: true,
      services: ["atelier"],
      dueInMinutes: null,
      expiresInDays: null,
      confidence: "moyenne",
      status: "a_traiter",
    },
    reason: "Suivi d'un OR existant : rattacher l'échange au dossier atelier, ne pas créer de nouveau dossier.",
  },
  {
    // §13 — suivi commercial client
    id: "suivi_commercial",
    any: ["remplacement de véhicule", "remplacement vehicule", "changer de voiture", "projet d'achat", "reprise de mon véhicule", "reprise de mon vehicule"],
    triage: {
      importance: "normale",
      urgency: "moyenne",
      actionRequired: true,
      humanRequired: true,
      services: ["vente_vo", "vente_vn"],
      dueInMinutes: 1 * DAY,
      expiresInDays: null,
      confidence: "moyenne",
      status: "a_traiter",
    },
    reason: "Suivi commercial client : réponse cible J+1, aucun OR ni commande avant concrétisation.",
  },
  {
    // §14 — partenariat commercial
    id: "partenariat",
    any: ["partenariat", "proposition de collaboration", "devenir partenaire", "référencement"],
    triage: {
      importance: "faible",
      urgency: "faible",
      actionRequired: true,
      humanRequired: true,
      services: ["direction"],
      dueInMinutes: 7 * DAY,
      expiresInDays: null,
      confidence: "moyenne",
      status: "a_traiter",
    },
    reason: "Partenariat commercial : réponse souhaitable sous 7 jours, aucune urgence opérationnelle.",
  },
  {
    // §10 — RH
    id: "rh_alternance",
    any: ["alternance", "apprenti", "calendrier de formation", "cfa", "tuteur"],
    triage: {
      importance: "normale",
      urgency: "aucune",
      actionRequired: false,
      humanRequired: false,
      services: ["rh", "atelier"],
      dueInMinutes: null,
      expiresInDays: null,
      confidence: "moyenne",
      status: "a_qualifier",
    },
    reason: "Information RH / alternance : à porter à connaissance du tuteur, du responsable de site et du secrétariat.",
  },
  {
    id: "rh_admin",
    any: ["dossier d'inscription", "documents d'inscription", "duerp", "document unique", "convention de stage", "visite médicale", "visite medicale"],
    triage: {
      importance: "normale",
      urgency: "moyenne",
      actionRequired: true,
      humanRequired: true,
      services: ["rh", "admin"],
      dueInMinutes: null,
      expiresInDays: null,
      confidence: "moyenne",
      status: "a_traiter",
    },
    reason: "RH administratif / conformité : urgence moyenne, échéance réelle à saisir humainement le cas échéant.",
  },
  {
    // §6 — info technique atelier
    id: "info_atelier",
    any: ["techline", "note technique", "information technique", "campagne de rappel technique", "bulletin technique"],
    triage: {
      importance: "normale",
      urgency: "aucune",
      actionRequired: false,
      humanRequired: false,
      services: ["atelier"],
      dueInMinutes: null,
      expiresInDays: null,
      confidence: "moyenne",
      status: "a_qualifier",
    },
    reason: "Information technique atelier : à lire, pièces jointes conservées, aucune tâche sans véhicule concerné.",
  },
  {
    // §7 — info vente
    id: "info_vente",
    any: ["flash commerce", "flash réseau", "flash reseau", "opération commerciale", "operation commerciale", "newsletter réseau", "actualité réseau"],
    triage: {
      importance: "normale",
      urgency: "aucune",
      actionRequired: false,
      humanRequired: false,
      services: ["vente_vn", "vente_vo"],
      dueInMinutes: null,
      expiresInDays: null,
      confidence: "moyenne",
      status: "a_qualifier",
    },
    reason: "Information vente / réseau : à lire par l'équipe vente, aucune tâche sans dossier client précis.",
  },
  {
    // §9 — info fournisseur temporaire
    id: "info_fournisseur",
    any: ["fermeture annuelle", "congés annuels", "conges annuels", "absence du", "invitation", "portes ouvertes", "salon"],
    triage: {
      importance: "faible",
      urgency: "aucune",
      actionRequired: false,
      humanRequired: false,
      services: ["atelier", "admin"],
      dueInMinutes: null,
      expiresInDays: null,
      confidence: "faible",
      status: "a_qualifier",
    },
    reason: "Information temporaire fournisseur : priorité faible. Date d'expiration renseignée seulement si une date réelle de retour / fin est connue.",
  },
  {
    // §8 — publicité pure
    id: "publicite",
    any: ["se désinscrire", "se desinscrire", "unsubscribe", "newsletter", "promotion exclusive", "offre spéciale", "offre speciale", "no-reply@", "noreply@"],
    triage: {
      importance: "faible",
      urgency: "aucune",
      actionRequired: false,
      humanRequired: false,
      services: [],
      dueInMinutes: null,
      expiresInDays: null,
      confidence: "faible",
      status: "sans_suite",
    },
    reason: "Publicité : aucune tâche, aucun CRM, aucune notification importante.",
  },
];

const DEFAULT_TRIAGE: Triage = {
  importance: "normale",
  urgency: "aucune",
  actionRequired: false,
  humanRequired: true,
  services: [],
  dueInMinutes: null,
  expiresInDays: null,
  confidence: "faible",
  status: "a_qualifier",
  reason: "Aucune règle métier certaine : à qualifier par un humain.",
};

function normalize(v: string): string {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Qualifie une information entrante.
 * `strongMatch` indique qu'un identifiant fort (VIN, immat, n° OR, n° sinistre…) a été
 * reconnu : la confiance passe à « forte » (§29).
 */
export function triageIncoming(input: {
  subject?: string | null | undefined;
  body?: string | null | undefined;
  from?: string | null | undefined;
  hasAttachments?: boolean;
  strongMatch?: boolean;
}): Triage {
  const hay = normalize(`${input.subject ?? ""} ${input.from ?? ""} ${(input.body ?? "").slice(0, 6000)}`);

  const matched = RULES.filter((r) => {
    const anyHit = r.any.some((w) => hay.includes(normalize(w)));
    if (!anyHit) return false;
    if (r.all && !r.all.every((w) => hay.includes(normalize(w)))) return false;
    return true;
  });

  if (!matched.length) return { ...DEFAULT_TRIAGE };

  // §3 — plusieurs services possibles sans duplication : on fusionne les rattachements.
  const services = Array.from(new Set(matched.flatMap((r) => r.triage.services))) as Service[];
  const primary = matched[0] as Rule;
  const worst = <T extends string>(order: readonly T[], values: T[]): T =>
    values.reduce((acc, v) => (order.indexOf(v) > order.indexOf(acc) ? v : acc), values[0] as T);

  const importance = worst<Importance>(["faible", "normale", "forte"], matched.map((r) => r.triage.importance));
  const urgency = worst<Urgency>(
    ["aucune", "faible", "moyenne", "haute", "immediate"],
    matched.map((r) => r.triage.urgency),
  );
  const actionRequired = matched.some((r) => r.triage.actionRequired);
  const dues = matched.map((r) => r.triage.dueInMinutes).filter((d): d is number => d != null);
  const expiries = matched.map((r) => r.triage.expiresInDays).filter((d): d is number => d != null);

  // §26 — le mot « urgent » de l'expéditeur ne suffit jamais à élever l'urgence.
  const triage: Triage = {
    importance,
    urgency,
    actionRequired,
    humanRequired: matched.some((r) => r.triage.humanRequired) || actionRequired,
    services,
    dueInMinutes: dues.length ? Math.min(...dues) : null,
    expiresInDays: expiries.length && !actionRequired ? Math.min(...expiries) : null,
    confidence: input.strongMatch ? "forte" : matched.length > 1 ? "moyenne" : primary.triage.confidence,
    status: actionRequired ? "a_traiter" : (primary.triage.status as TriageStatus),
    reason: matched.map((r) => r.reason).join(" "),
  };

  // §2 — une pièce jointe exploitable doit être lue avant classement définitif.
  if (input.hasAttachments && triage.confidence === "faible" && triage.status !== "sans_suite") {
    triage.status = "a_qualifier";
  }
  return triage;
}

export function dueAtFrom(sentAt: string, dueInMinutes: number | null): string | null {
  if (dueInMinutes == null) return null;
  return new Date(new Date(sentAt).getTime() + dueInMinutes * 60_000).toISOString();
}

export function expiresAtFrom(sentAt: string, expiresInDays: number | null): string | null {
  if (expiresInDays == null) return null;
  return new Date(new Date(sentAt).getTime() + expiresInDays * 86_400_000).toISOString();
}
