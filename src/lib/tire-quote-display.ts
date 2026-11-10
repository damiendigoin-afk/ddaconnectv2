/**
 * Lecture d'affichage d'une offre pneus déjà chiffrée par priceTireLine.
 * Aucun recalcul métier : le prix de VENTE unitaire HT est celui du moteur
 * (base HT + marge, arrondi au centime), jamais le prix d'achat. La pose
 * n'y est jamais incluse.
 */
import type { SevenOffer } from "@/lib/tires";

export type OfferPriceLines = {
  /** Prix de vente unitaire HT d'UN pneu, hors montage (ligne pièce WinMotor). */
  unitSellHt: number | null;
  quantity: number;
  /** Pneus HT = unitaire HT × quantité. */
  tiresHt: number | null;
  /** Montage (main-d'œuvre) TTC, déjà multiplié par la quantité. */
  mountTtc: number | null;
  totalTtc: number | null;
};

export function offerPriceLines(o: SevenOffer): OfferPriceLines {
  const quantity = Math.max(1, Number(o.quantity) || 1);
  const unit = Number.isFinite(o.unitSellHt as number) ? (o.unitSellHt as number) : null;
  return {
    unitSellHt: unit,
    quantity,
    tiresHt: o.tiresHt ?? (unit == null ? null : Math.round(unit * quantity * 100) / 100),
    mountTtc: o.mountTtc ?? null,
    totalTtc: o.totalTtc ?? null,
  };
}

export function euroFr(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2).replace(".", ",")} €`;
}

export const UNIT_HT_LABEL = "Prix de vente unitaire HT / pneu";
