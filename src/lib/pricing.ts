/**
 * Tarifs atelier : grilles versionnées avec date de prise d'effet.
 * Aucun taux n'est codé en dur dans le moteur de chiffrage : tout provient
 * de la grille active en base (grille DDA 2026 par défaut).
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type PricingGrid = Database["public"]["Tables"]["pricing_grids"]["Row"];
export type PricingRate = Database["public"]["Tables"]["pricing_rates"]["Row"];

export type RateCategory = "labor" | "igp" | "service";

export const CATEGORY_LABEL: Record<RateCategory, string> = {
  labor: "Main-d'œuvre mécanique et tôlerie / peinture",
  igp: "Ingrédients peinture (IGP)",
  service: "Autres prestations atelier",
};

/** Taux technique appliqué par défaut aux interventions carrosserie / peinture. */
export const DEFAULT_TECHNICAL_RATE_CODE = "taux_2";

/** Colorimétrie : 1,0 h par intervention peinture (générant elle aussi des IGP). */
export const COLORIMETRY_HOURS = 1;

export const PAINT_TYPES = [
  { key: "opaque", label: "Opaque", igpCode: "igp_opaque" },
  { key: "metallisee", label: "Métallisée vernie", igpCode: "igp_metallisee" },
  { key: "nacree", label: "Nacrée", igpCode: "igp_nacree" },
] as const;

export type PaintType = (typeof PAINT_TYPES)[number]["key"];

export type PricingContext = { grid: PricingGrid; rates: PricingRate[] };

/* ------------------------------- Lectures ------------------------------- */

export async function fetchGrids(): Promise<PricingGrid[]> {
  const { data, error } = await supabase
    .from("pricing_grids")
    .select("*")
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchRates(gridId: string): Promise<PricingRate[]> {
  const { data, error } = await supabase
    .from("pricing_rates")
    .select("*")
    .eq("grid_id", gridId)
    .order("category")
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
}

/** Grille en vigueur à une date donnée (la plus récente dont la date d'effet est passée). */
export async function fetchActiveGrid(at: Date = new Date()): Promise<PricingContext | null> {
  const day = at.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("pricing_grids")
    .select("*")
    .lte("effective_from", day)
    .order("effective_from", { ascending: false })
    .limit(1);
  if (error) throw error;
  const grid = (data ?? [])[0];
  if (!grid) return null;
  return { grid, rates: await fetchRates(grid.id) };
}

/* -------------------------------- Écritures ------------------------------ */

export async function updateRate(
  id: string,
  patch: { amount_ht?: number | null; amount_ttc?: number | null; label?: string },
) {
  const { error } = await supabase.from("pricing_rates").update(patch).eq("id", id);
  if (error) throw error;
}

/** Crée une nouvelle grille (ex. 2027) en dupliquant les tarifs d'une grille existante. */
export async function duplicateGrid(args: {
  sourceGridId: string;
  name: string;
  effectiveFrom: string;
  notes?: string;
}): Promise<PricingGrid> {
  const { data: created, error } = await supabase
    .from("pricing_grids")
    .insert({ name: args.name, effective_from: args.effectiveFrom, notes: args.notes ?? null })
    .select("*")
    .single();
  if (error) throw error;
  const source = await fetchRates(args.sourceGridId);
  if (source.length) {
    const { error: e2 } = await supabase.from("pricing_rates").insert(
      source.map((r) => ({
        grid_id: created.id,
        category: r.category,
        code: r.code,
        label: r.label,
        amount_ht: r.amount_ht,
        amount_ttc: r.amount_ttc,
        unit: r.unit,
        sort_order: r.sort_order,
      })),
    );
    if (e2) throw e2;
  }
  return created;
}

/* ----------------------------- Moteur de calcul --------------------------- */

export function rateOf(rates: PricingRate[], code: string): { ht: number; ttc: number } | null {
  const r = rates.find((x) => x.code === code);
  if (!r) return null;
  return { ht: Number(r.amount_ht ?? 0), ttc: Number(r.amount_ttc ?? 0) };
}

export function laborRate(rates: PricingRate[], code = DEFAULT_TECHNICAL_RATE_CODE) {
  return rateOf(rates, code) ?? { ht: 0, ttc: 0 };
}

export function igpRate(rates: PricingRate[], paint: PaintType) {
  const def = PAINT_TYPES.find((p) => p.key === paint) ?? PAINT_TYPES[0];
  return rateOf(rates, def.igpCode) ?? { ht: 0, ttc: 0 };
}

/** Frais de déchets selon le montant HT de la facture. */
export function wasteFee(rates: PricingRate[], invoiceHt: number) {
  return rateOf(rates, invoiceHt >= 1000 ? "dechets_1000_plus" : "dechets_moins_1000") ?? { ht: 0, ttc: 0 };
}

export type PaintQuoteInput = {
  /** Heures de peinture chiffrées (hors colorimétrie). */
  paintHours: number;
  paintType: PaintType;
  /** Taux de main-d'œuvre appliqué (taux technique par défaut). */
  laborCode?: string;
  /** Nombre d'interventions peinture (1,0 h de colorimétrie chacune). */
  interventions?: number;
};

export type QuoteLine = { label: string; hours?: number; unitHt: number; totalHt: number; totalTtc: number };

/**
 * Chiffrage peinture : heures peinture + colorimétrie (1 h / intervention),
 * puis IGP à hauteur d'une heure d'IGP par heure de peinture (colorimétrie incluse).
 */
export function paintQuote(rates: PricingRate[], input: PaintQuoteInput): { lines: QuoteLine[]; totalHt: number; totalTtc: number } {
  const labor = laborRate(rates, input.laborCode ?? DEFAULT_TECHNICAL_RATE_CODE);
  const igp = igpRate(rates, input.paintType);
  const colorimetryHours = COLORIMETRY_HOURS * (input.interventions ?? 1);
  const paintedHours = input.paintHours + colorimetryHours;

  const lines: QuoteLine[] = [
    line("Main-d'œuvre peinture", input.paintHours, labor),
    line("Colorimétrie", colorimetryHours, labor),
    line(`Ingrédients peinture (${PAINT_TYPES.find((p) => p.key === input.paintType)?.label ?? ""})`, paintedHours, igp),
  ];
  return sum(lines);
}

export function laborQuote(rates: PricingRate[], hours: number, code = DEFAULT_TECHNICAL_RATE_CODE, label = "Main-d'œuvre") {
  return sum([line(label, hours, laborRate(rates, code))]);
}

function line(label: string, hours: number, rate: { ht: number; ttc: number }): QuoteLine {
  return { label, hours, unitHt: rate.ht, totalHt: round(hours * rate.ht), totalTtc: round(hours * rate.ttc) };
}

function sum(lines: QuoteLine[]) {
  return {
    lines,
    totalHt: round(lines.reduce((s, l) => s + l.totalHt, 0)),
    totalTtc: round(lines.reduce((s, l) => s + l.totalTtc, 0)),
  };
}

function round(v: number) {
  return Math.round(v * 100) / 100;
}

/**
 * Instantané des taux à figer sur un chiffrage validé : un changement de grille
 * ultérieur ne doit jamais modifier un devis déjà établi.
 */
export function snapshotOf(ctx: PricingContext) {
  return {
    grid_id: ctx.grid.id,
    grid_name: ctx.grid.name,
    effective_from: ctx.grid.effective_from,
    captured_at: new Date().toISOString(),
    rates: ctx.rates.map((r) => ({
      code: r.code,
      label: r.label,
      amount_ht: r.amount_ht == null ? null : Number(r.amount_ht),
      amount_ttc: r.amount_ttc == null ? null : Number(r.amount_ttc),
      unit: r.unit,
    })),
  };
}

/** Taux à utiliser pour un chiffrage : instantané figé si présent, sinon grille active. */
export function ratesFromSnapshot(snapshot: unknown): PricingRate[] | null {
  const s = snapshot as { rates?: { code: string; label: string; amount_ht: number | null; amount_ttc: number | null; unit: string }[] } | null;
  if (!s?.rates?.length) return null;
  return s.rates.map((r, i) => ({
    id: `snapshot-${r.code}`,
    grid_id: "snapshot",
    category: "labor",
    code: r.code,
    label: r.label,
    amount_ht: r.amount_ht,
    amount_ttc: r.amount_ttc,
    unit: r.unit,
    sort_order: i,
    created_at: "",
    updated_at: "",
  })) as PricingRate[];
}

export function euroHt(v: number | null): string {
  if (v == null) return "—";
  return `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}
