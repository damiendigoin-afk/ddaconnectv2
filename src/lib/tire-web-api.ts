/**
 * Devis pneus — Site web : contrat public (règles pures, testables).
 * Entrée stricte, réponse en liste blanche, CORS, préparation à l'activation.
 * Aucun prix d'achat, marge, référence/URL fournisseur ni message interne.
 */
import { z } from "zod";

import type { SevenOffer } from "./tires";
import { WEB_QUOTE_CASES } from "./tire-web-quote";

export const WEB_QUOTE_MAX_BODY_BYTES = 1024;
export const WEB_QUOTE_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_ALLOWED_ORIGIN = "https://dda-pneus-premiere-version.genialdrake34.chatgpt.site";
export const DEFAULT_ALLOWED_ORIGINS = [DEFAULT_ALLOWED_ORIGIN, "https://pneu.garagecastillon.fr"];

const SPEED = /^(?:[LMNPQRSTUHVWY]|ZR)$/;
export const webQuoteInput = z
  .object({
    width: z.number().int().min(105).max(395),
    ratio: z.number().int().min(25).max(95),
    rim: z.number().int().min(10).max(24),
    loadIndex: z.number().int().min(50).max(130),
    speedIndex: z.string().regex(SPEED),
    quantity: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  })
  .strict();
export type WebQuoteInput = z.infer<typeof webQuoteInput>;

/** Clé de cache/déduplication : uniquement des critères pneus, aucune donnée personnelle. */
export function webQuoteKey(i: WebQuoteInput): string {
  return `${i.width}/${i.ratio}R${i.rim}|${i.loadIndex}${i.speedIndex}|q${i.quantity}`;
}

export type WebQuoteCase = {
  tier: "entree" | "milieu" | "haut";
  season: "ete" | "quatre_saisons";
  status: "available" | "unavailable";
  brand: string | null;
  model: string | null;
  size: string | null;
  loadIndex: string | null;
  speedIndex: string | null;
  quantity: number;
  totalTtcCents: number | null;
  includedServices: { code: "montage"; label: string }[];
  compatibility: "compatible" | "to_confirm" | null;
  compatibilityMessage: string | null;
};

export type WebQuoteResponse = {
  quoteId: string;
  currency: "EUR";
  generatedAt: string;
  expiresAt: string;
  request: { size: string; loadIndex: number; speedIndex: string; quantity: number };
  partial: boolean;
  notice: string | null;
  cases: WebQuoteCase[];
};

const PARTIAL_NOTICE =
  "Une partie des sources tarifaires n'a pas répondu : les propositions peuvent être incomplètes.";

/** Liste blanche : chaque champ est recopié explicitement, rien d'autre ne sort. */
export function toWebCase(o: SevenOffer | undefined, tier: WebQuoteCase["tier"], season: WebQuoteCase["season"], quantity: number): WebQuoteCase {
  const total = o?.available ? o.totalTtc : null;
  const ok = !!o && o.available && typeof total === "number" && Number.isFinite(total) && total > 0;
  if (!ok) {
    return {
      tier, season, status: "unavailable", brand: null, model: null, size: null, loadIndex: null, speedIndex: null,
      quantity, totalTtcCents: null, includedServices: [], compatibility: null, compatibilityMessage: null,
    };
  }
  const mountIncluded = o.mountTtc != null && o.mountTtc > 0;
  return {
    tier,
    season,
    status: "available",
    brand: o.brand,
    model: o.model,
    size: o.size,
    loadIndex: o.loadIndex,
    speedIndex: o.speedIndex,
    quantity: o.quantity,
    totalTtcCents: Math.round((total as number) * 100),
    includedServices: mountIncluded ? [{ code: "montage", label: o.mountLabel ?? "Montage" }] : [],
    // Disponibilité volontairement jamais exposée (hors périmètre du site public).
    compatibility: o.compatibility === "compatible" ? "compatible" : "to_confirm",
    // L'avertissement « à confirmer » n'est jamais retiré.
    compatibilityMessage: o.compatibilityMessage || null,
  };
}

export function buildWebQuoteResponse(args: {
  grid: SevenOffer[];
  input: WebQuoteInput;
  partial: boolean;
  quoteId: string;
  now: Date;
}): WebQuoteResponse {
  const { grid, input } = args;
  return {
    quoteId: args.quoteId,
    currency: "EUR",
    generatedAt: args.now.toISOString(),
    expiresAt: new Date(args.now.getTime() + WEB_QUOTE_TTL_MS).toISOString(),
    request: { size: `${input.width}/${input.ratio}R${input.rim}`, loadIndex: input.loadIndex, speedIndex: input.speedIndex, quantity: input.quantity },
    partial: args.partial,
    notice: args.partial ? PARTIAL_NOTICE : null,
    cases: WEB_QUOTE_CASES.map((c) => toWebCase(grid.find((g) => g.slot === `${c.tier}_${c.season}`), c.tier, c.season, input.quantity)),
  };
}

/* --------------------------- Configuration / état -------------------------- */

export type WebQuoteConfig = {
  web_supplier: string | null;
  site_id: string | null;
  enabled: boolean;
  allowed_origin?: string | null;
  allowed_origins: string[] | null;
  quota_ip_per_10min: number;
  quota_global_per_hour: number;
};

export function validOrigin(o: string | null | undefined): boolean {
  return !!o && /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(o);
}

/**
 * Conditions d'activation. Top prix inclut Districash, dont le compte est
 * propre à un site : l'établissement est donc obligatoire et ne doit jamais
 * être choisi arbitrairement (aucun parcours de tous les comptes).
 */
export function webReadiness(c: Partial<WebQuoteConfig> | null, districashConfigured: boolean | null): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!c || c.web_supplier !== "top_prix") reasons.push("Le mode « Top prix » doit être choisi explicitement.");
  if (!c?.site_id)
    reasons.push("Établissement requis : Top prix consulte Districash, dont le compte dépend du site.");
  else if (districashConfigured === false) reasons.push("Identifiants Districash absents pour l'établissement choisi.");
  else if (districashConfigured === null) reasons.push("État Districash de l'établissement non vérifié.");
  const origins = c?.allowed_origins ?? [];
  if (!origins.length || !origins.every(validOrigin)) reasons.push("Origines autorisées du site vitrine manquantes ou invalides (https://…).");
  if (!c || !(Number(c.quota_ip_per_10min) > 0) || !(Number(c.quota_global_per_hour) > 0)) reasons.push("Quotas d'appels non définis.");
  return { ok: reasons.length === 0, reasons };
}

/** Origine exactement présente dans la liste autorisée (aucun joker, aucun suffixe). */
export function originAllowed(origin: string | null, allowed: string[] | null | undefined): boolean {
  return !!origin && validOrigin(origin) && (allowed ?? []).includes(origin);
}

export function corsHeaders(origin: string | null, allowed: string[] | null | undefined): Record<string, string> {
  const h: Record<string, string> = { Vary: "Origin" };
  if (originAllowed(origin, allowed)) {
    h["Access-Control-Allow-Origin"] = origin as string;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}

/* ------------------------- Demande de rendez-vous ------------------------- */

export const WEB_APPT_MAX_BODY_BYTES = 4096;
/** Délai minimal de saisie du formulaire (anti-robot simple). */
export const WEB_APPT_MIN_FILL_MS = 3000;

const SLOT = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    period: z.enum(["matin", "apres_midi"]),
  })
  .strict();

export const webAppointmentInput = z
  .object({
    quoteId: z.string().uuid(),
    /** Garage choisi explicitement par le client (affiché et modifiable avant envoi). */
    site: z.enum(["castillon", "lalinde"]),
    siteChoiceMethod: z.enum(["default", "geolocation", "postal", "manual"]),
    suggestedSite: z.enum(["castillon", "lalinde"]).optional(),
    tier: z.enum(["entree", "milieu", "haut"]),
    season: z.enum(["ete", "quatre_saisons"]),
    name: z.string().trim().min(2).max(100),
    phone: z.string().trim().regex(/^[+0-9 ().-]{6,20}$/).optional(),
    email: z.string().trim().email().max(255).optional(),
    plate: z.string().trim().max(12).regex(/^[A-Za-z0-9 -]*$/).optional(),
    preferredSlots: z.array(SLOT).min(1).max(3),
    message: z.string().trim().max(500).optional(),
    consent: z.literal(true),
    /** Pot de miel : doit rester vide. */
    website: z.string().max(200).optional(),
    /** Temps passé sur le formulaire (ms), fourni par le site. */
    formElapsedMs: z.number().int().min(0).max(86_400_000),
  })
  .strict()
  .refine((v) => !!v.phone || !!v.email, { path: ["phone"], message: "Téléphone ou e-mail requis." });
export type WebAppointmentInput = z.infer<typeof webAppointmentInput>;

/** Signaux de robot : réponse neutre, rien n'est enregistré. */
export function looksLikeBot(i: Pick<WebAppointmentInput, "website" | "formElapsedMs">): boolean {
  return !!(i.website && i.website.trim()) || i.formElapsedMs < WEB_APPT_MIN_FILL_MS;
}

/** Créneaux : uniquement aujourd'hui → +60 jours (date Europe/Paris approximée en UTC). */
export function slotsInRange(slots: { date: string }[], now: Date): boolean {
  const today = now.toISOString().slice(0, 10);
  const max = new Date(now.getTime() + 60 * 86_400_000).toISOString().slice(0, 10);
  return slots.every((s) => s.date >= today && s.date <= max);
}
