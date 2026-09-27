import { Check, Snowflake, Sun } from "lucide-react";

import type { TireQuoteChoice } from "@/lib/tour-tire-groups";

function euro(value: number | null) {
  return value == null
    ? "—"
    : `${value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

type Tier = "entree" | "milieu" | "haut";

/** Couleur unique par gamme (jetons du thème, contraste accessible). */
export function tierTone(tier: Tier | null | undefined) {
  switch (tier) {
    case "entree":
      return { text: "text-tier-entree", soft: "bg-tier-entree-soft", border: "border-tier-entree" };
    case "milieu":
      return { text: "text-tier-milieu", soft: "bg-tier-milieu-soft", border: "border-tier-milieu" };
    case "haut":
      return { text: "text-tier-haut", soft: "bg-tier-haut-soft", border: "border-tier-haut" };
    default:
      return { text: "text-foreground", soft: "bg-secondary", border: "border-foreground" };
  }
}

const TIER_ROWS: { tier: Tier; label: string }[] = [
  { tier: "entree", label: "Entrée" },
  { tier: "milieu", label: "Milieu" },
  { tier: "haut", label: "Haut" },
];

function OfferCard({
  offer,
  selected,
  onSelect,
  disabled,
  compact,
}: {
  offer: TireQuoteChoice | undefined;
  selected: boolean;
  onSelect?: ((offer: TireQuoteChoice) => void) | undefined;
  disabled: boolean;
  compact?: boolean;
}) {
  if (!offer) {
    return <div className="rounded-lg border-2 border-dashed border-border p-2 text-xs text-muted-foreground">Indisponible</div>;
  }
  const tone = tierTone(offer.kind === "identique" ? null : (offer.tier as Tier | null));
  const usable = offer.available && offer.totalTtc != null;
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className={`min-w-0 font-bold leading-tight ${compact ? "text-xs" : "text-sm"}`}>
          {usable ? [offer.brand, offer.model].filter(Boolean).join(" ") || "Pneu" : "Indisponible"}
        </div>
        {selected ? (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground">
            <Check className="h-3.5 w-3.5" aria-label="Offre retenue" />
          </span>
        ) : null}
      </div>
      <div className={`mt-1 font-extrabold ${compact ? "text-sm" : "text-base"} ${usable ? tone.text : "text-muted-foreground"}`}>
        {usable ? `${euro(offer.totalTtc)}` : "—"}
        {usable ? <span className="ml-1 text-[10px] font-semibold text-muted-foreground">TTC posé</span> : null}
      </div>
      <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
        {usable
          ? [offer.compatibilityMessage, offer.availability].filter(Boolean).join(" · ")
          : offer.unavailableReason}
      </div>
    </>
  );
  const cls = `w-full rounded-lg border-2 p-2 text-left transition ${
    selected ? `${tone.border} ${tone.soft}` : "border-border bg-card"
  }`;
  return onSelect ? (
    <button
      type="button"
      disabled={disabled || !usable}
      onClick={() => onSelect(offer)}
      aria-pressed={selected}
      className={`${cls} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  );
}

/**
 * Sept propositions : Équivalence en tête (pleine largeur), puis matrice
 * gammes (lignes) × saisons (colonnes Été / 4 saisons).
 */
export function TireOfferGrid({
  offers,
  selectedSlot,
  onSelect,
  disabled = false,
}: {
  offers: TireQuoteChoice[];
  selectedSlot: string | null;
  onSelect?: (offer: TireQuoteChoice) => void;
  disabled?: boolean;
}) {
  const bySlot = new Map(offers.map((o) => [o.slot, o]));
  const equivalence = bySlot.get("identique");
  return (
    <div className="space-y-2">
      <div>
        <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Équivalence</div>
        <OfferCard offer={equivalence} selected={selectedSlot === "identique"} onSelect={onSelect} disabled={disabled} />
      </div>
      <div className="grid grid-cols-[3.5rem_1fr_1fr] gap-1.5 sm:grid-cols-[4.5rem_1fr_1fr]">
        <div />
        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <Sun className="h-3 w-3" /> Été
        </div>
        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <Snowflake className="h-3 w-3" /> 4 saisons
        </div>
        {TIER_ROWS.map(({ tier, label }) => {
          const tone = tierTone(tier);
          return [
            <div
              key={`${tier}-label`}
              className={`flex items-center justify-center rounded-lg px-1 text-[10px] font-extrabold uppercase ${tone.soft} ${tone.text}`}
            >
              {label}
            </div>,
            ...(["ete", "quatre_saisons"] as const).map((season) => {
              const slot = `${tier}_${season}`;
              return (
                <OfferCard
                  key={slot}
                  offer={bySlot.get(slot)}
                  selected={selectedSlot === slot}
                  onSelect={onSelect}
                  disabled={disabled}
                  compact
                />
              );
            }),
          ];
        })}
      </div>
    </div>
  );
}
