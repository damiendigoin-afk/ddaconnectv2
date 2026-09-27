import { Check } from "lucide-react";

import { Badge } from "@/components/bits";
import { SEASON_LABEL, TIER_LABEL } from "@/lib/tires";
import type { TireQuoteChoice } from "@/lib/tour-tire-groups";

function euro(value: number | null) {
  return value == null ? "—" : `${value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

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
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {offers.map((offer) => {
        const selected = offer.slot === selectedSlot;
        const content = (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              {offer.kind === "identique" ? (
                <Badge tone="bg-secondary text-foreground">Équivalence</Badge>
              ) : (
                <>
                  <Badge tone="bg-secondary text-foreground">{offer.season ? SEASON_LABEL[offer.season] : "Saison"}</Badge>
                  <Badge>{offer.tier ? TIER_LABEL[offer.tier] : "Gamme"}</Badge>
                </>
              )}
              {selected ? <Check className="ml-auto h-4 w-4 text-brand" aria-label="Offre retenue" /> : null}
            </div>
            <div className="mt-2 min-h-10 text-sm font-bold leading-tight">
              {[offer.brand, offer.model].filter(Boolean).join(" ") || "Non disponible"}
            </div>
            <div className="mt-1 text-base font-extrabold">
              {offer.available ? `${euro(offer.totalTtc)} TTC posé` : "—"}
            </div>
            <div className="mt-1 text-[11px] leading-tight text-muted-foreground">
              {offer.available
                ? [offer.compatibilityMessage, offer.availability || "Disponibilité à confirmer"].filter(Boolean).join(" · ")
                : offer.unavailableReason}
            </div>
          </>
        );
        return onSelect ? (
          <button
            key={offer.slot}
            type="button"
            disabled={disabled || !offer.available || offer.totalTtc == null}
            onClick={() => onSelect(offer)}
            className={`min-h-32 rounded-lg border-2 p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${selected ? "border-brand bg-brand/5" : "border-border bg-card"}`}
          >
            {content}
          </button>
        ) : (
          <div key={offer.slot} className={`min-h-32 rounded-lg border-2 p-3 ${selected ? "border-brand bg-brand/5" : "border-border bg-card"}`}>
            {content}
          </div>
        );
      })}
    </div>
  );
}