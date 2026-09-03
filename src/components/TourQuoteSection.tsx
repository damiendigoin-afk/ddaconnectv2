/**
 * Chiffrage et proposition client d'un Tour Véhicule, produit par le moteur
 * central. L'IA/le moteur proposent, l'opérateur décide : chaque ligne reste
 * modifiable et le client répond ensuite ligne par ligne.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Calculator, Copy } from "lucide-react";
import { toast } from "sonner";

import { QuoteBlocks, type DisplayLine } from "@/components/QuoteLines";
import { useAuth } from "@/lib/auth";
import {
  createQuote,
  fetchQuoteForSource,
  removeLine,
  updateLine,
  type QuoteLine,
} from "@/lib/quotes";
import { describeUnpricedTour, priceTour, type UnpricedObservation } from "@/lib/tour-pricing";
import { prepareTourPricing } from "@/lib/tour-recompute";

import type { Confidence, PriceSource, Priority, QuoteBlock } from "@/lib/pricing-engine";

/** Origine lisible de la ligne : le client et l'opérateur voient d'où elle vient. */
function originLabel(pointKey: string | null): string {
  if (!pointKey) return "Issu du tour véhicule";
  if (/^pneu/.test(pointKey)) return "Pneus issus du tour véhicule";
  if (/^batterie/.test(pointKey)) return "Batterie issue du tour véhicule";
  return "Constat issu du tour véhicule";
}

function toDisplay(l: QuoteLine): DisplayLine {
  const origin = originLabel(l.origin_point_key);
  return {
    id: l.id,
    block: (l.block as QuoteBlock) ?? "mecanique",
    label: l.label,
    detail: [origin, l.detail].filter(Boolean).join(" — "),
    priority: (l.priority as Priority) ?? "a_prevoir",
    totalTtc: Number(l.total_ttc),
    needsContact: l.needs_contact,
    confidence: (l.confidence as Confidence) ?? "moyenne",
    source: (l.price_source as PriceSource) ?? "saisie_manuelle",
  };
}

export function TourQuoteSection({
  inspectionId,
  plate,
  brand,
  model,
  repairOrderId,
}: {
  inspectionId: string;
  plate?: string | null;
  brand?: string | null;
  model?: string | null;
  repairOrderId?: string | null;
}) {
  const { user, displayName } = useAuth();
  const [busy, setBusy] = useState(false);
  const [emptyReport, setEmptyReport] = useState<UnpricedObservation[] | null>(null);

  const quote = useQuery({
    queryKey: ["tour-quote", inspectionId],
    queryFn: () => fetchQuoteForSource("tour_vehicule", inspectionId),
  });

  async function generate() {
    setBusy(true);
    try {
      // Recalcul autonome : offres pneus reconstruites depuis l'étiquette déjà
      // enregistrée, ticket batterie existant relu, avant tout chiffrage.
      const prep = await prepareTourPricing(inspectionId);
      if (prep.tireWheels) {
        toast.info(
          `Offres pneumatiques reconstruites pour ${prep.tireWheels} roue(s) (${prep.tireOffers} propositions).`,
        );
      }
      if (prep.batteryRead) toast.info("Ticket batterie existant relu automatiquement.");
      for (const note of prep.notes.slice(0, 3)) toast.warning(note);
      const { ctx, vehicle, items } = await priceTour({
        inspectionId,
        plate: plate ?? null,
        brand: brand ?? null,
        model: model ?? null,
      });

      if (!items.length) {
        setEmptyReport(await describeUnpricedTour(inspectionId));
        toast.info("Aucun constat chiffrable : le détail des observations est affiché.");
        return;
      }
      setEmptyReport(null);
      await createQuote({
        ctx,
        items,
        sourceModule: "tour_vehicule",
        sourceId: inspectionId,
        repairOrderId: repairOrderId ?? null,
        refVehicleId: vehicle.refVehicleId ?? null,
        plate: plate ?? null,
        createdBy: user?.id ?? null,
        createdByName: displayName || null,
      });
      await quote.refetch();
      const incomplete = items.filter((i) => isIncompleteLine(i)).length;
      if (incomplete) {
        toast.success("Offres enregistrées. Compléter les lignes incomplètes avant validation.");
      } else {
        toast.success("Offres enregistrées.");
      }
    } catch (e) {
      console.error("[chiffrage tour]", e);
      const reason =
        e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
      toast.error(`Offres non enregistrées : ${reason}`);
    } finally {
      setBusy(false);
    }
  }

  async function editLine(l: DisplayLine) {
    if (!l.id) return;
    const raw = window.prompt("Nouveau montant TTC (€) — laisser vide pour supprimer la ligne", l.totalTtc.toFixed(2));
    if (raw === null) return;
    if (raw.trim() === "") {
      await removeLine(l.id);
    } else {
      const ttc = Number(raw.replace(",", "."));
      if (!Number.isFinite(ttc)) {
        toast.error("Montant invalide");
        return;
      }
      await updateLine(l.id, {
        total_ttc: Math.round(ttc * 100) / 100,
        total_ht: Math.round((ttc / 1.2) * 100) / 100,
        price_source: "saisie_manuelle",
        confidence: "elevee",
        needs_contact: false,
      });
    }
    await quote.refetch();
  }

  const data = quote.data;
  const lines = (data?.lines ?? []).map(toDisplay);
  const clientUrl = data ? `${window.location.origin}/devis/${data.quote.share_token}` : "";

  return (
    <section className="card-surface space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-widest">Chiffrage & proposition client</h2>
        <button
          onClick={() => void generate()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-bold uppercase text-brand-foreground disabled:opacity-60"
        >
          <Calculator className="h-4 w-4" />
          {data ? "Recalculer" : "Chiffrer les constats"}
        </button>
      </div>

      {emptyReport ? (
        <div className="rounded-lg border border-dashed border-border p-3 text-xs">
          <p className="font-bold uppercase">Aucun élément chiffrable trouvé</p>
          {emptyReport.length ? (
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {emptyReport.map((o) => (
                <li key={o.pointKey}>
                  <span className="font-semibold text-foreground">{o.label}</span> — {o.statusLabel} · {o.reason}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-muted-foreground">
              Tous les points du tour sont conformes : rien à proposer au client.
            </p>
          )}
        </div>
      ) : null}

      {!data ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          Aucun chiffrage pour ce tour. Les constats « à surveiller » et « défaut » seront chiffrés
          par le moteur central, puis restent modifiables.
        </p>
      ) : (
        <>
          <QuoteBlocks lines={lines} onEdit={(l) => void editLine(l)} />
          <p className="text-[11px] text-muted-foreground">
            Chaque ligne est modifiable (montant TTC) ou supprimable (champ laissé vide) avant validation.
            Aucun devis n'est envoyé automatiquement.
          </p>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(clientUrl);
              toast.success("Lien client copié");
            }}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-3 text-xs font-bold uppercase"
          >
            <Copy className="h-4 w-4" /> Copier le lien du devis interactif client
          </button>
        </>
      )}
    </section>
  );
}
