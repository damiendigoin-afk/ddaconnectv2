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
  availability: string | null;
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
      quantity, totalTtcCents: null, includedServices: [], availability: null, compatibility: null, compatibilityMessage: null,
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
    availability: o.availability ?? null,
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
  allowed_origin: string | null;
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
  if (!validOrigin(c?.allowed_origin)) reasons.push("Origine autorisée du site vitrine manquante ou invalide (https://…).");
  if (!c || !(Number(c.quota_ip_per_10min) > 0) || !(Number(c.quota_global_per_hour) > 0)) reasons.push("Quotas d'appels non définis.");
  return { ok: reasons.length === 0, reasons };
}

export function corsHeaders(origin: string | null, allowed: string | null): Record<string, string> {
  const h: Record<string, string> = { Vary: "Origin" };
  if (origin && allowed && origin === allowed) {
    h["Access-Control-Allow-Origin"] = allowed;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}
