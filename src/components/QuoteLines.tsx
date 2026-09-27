/**
 * Affichage unifié des prix : utilisé par le Tour Véhicule, l'Expertise,
 * l'entretien prévisionnel, l'aperçu client et le devis. Chaque ligne montre
 * défaut, priorité, prix, confiance, origine du prix, modification et ajout.
 */
import { Pencil, Plus } from "lucide-react";

import { Badge } from "@/components/bits";
import { TireOfferGrid } from "@/components/TireOfferGrid";
import {
  BLOCK_LABEL,
  CONFIDENCE_LABEL,
  CONTACT_US,
  PRIORITY_LABEL,
  SOURCE_LABEL,
  type Confidence,
  type PriceSource,
  type Priority,
  type QuoteBlock,
} from "@/lib/pricing-engine";
import { isTireQuoteComputation, type TireQuoteChoice } from "@/lib/tour-tire-groups";

export type DisplayLine = {
  id?: string;
  block: QuoteBlock;
  label: string;
  detail?: string | null;
  priority: Priority;
  totalTtc: number;
  needsContact: boolean;
  confidence: Confidence;
  source: PriceSource;
  computation?: unknown;
};

const PRIORITY_TONE: Record<Priority, string> = {
  urgent: "bg-red-100 text-red-950",
  a_remplacer: "bg-orange-100 text-orange-950",
  conseille: "bg-amber-100 text-amber-950",
  a_surveiller: "bg-secondary text-foreground",
  a_prevoir: "bg-secondary text-foreground",
};

const CONFIDENCE_TONE: Record<Confidence, string> = {
  elevee: "bg-emerald-100 text-emerald-950",
  moyenne: "bg-amber-100 text-amber-950",
  faible: "bg-red-100 text-red-950",
};

export function priceLabel(line: Pick<DisplayLine, "needsContact" | "totalTtc">) {
  if (line.needsContact) return CONTACT_US;
  return `${line.totalTtc.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € TTC`;
}

export function QuoteLineRow({
  line,
  onEdit,
  onAdd,
  onSelectTire,
}: {
  line: DisplayLine;
  onEdit?: () => void;
  onAdd?: () => void;
  onSelectTire?: (offer: TireQuoteChoice) => void;
}) {
  const tireGroup = isTireQuoteComputation(line.computation) ? line.computation : null;
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{line.label}</div>
          {line.detail ? (
            <div className="mt-0.5 text-xs text-muted-foreground">{line.detail}</div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={PRIORITY_TONE[line.priority]}>{PRIORITY_LABEL[line.priority]}</Badge>
            <Badge tone={CONFIDENCE_TONE[line.confidence]}>{CONFIDENCE_LABEL[line.confidence]}</Badge>
            <Badge>{SOURCE_LABEL[line.source]}</Badge>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-sm font-extrabold ${line.needsContact ? "text-muted-foreground" : ""}`}>
            {priceLabel(line)}
          </div>
          <div className="mt-2 flex justify-end gap-2">
            {onEdit ? (
              <button
                onClick={onEdit}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs font-bold uppercase"
              >
                <Pencil aria-hidden="true" focusable="false" className="h-3.5 w-3.5" /> <span>Modifier</span>
              </button>
            ) : null}
            {onAdd ? (
              <button
                onClick={onAdd}
                className="inline-flex items-center gap-1 rounded-lg bg-brand px-2 py-1.5 text-xs font-bold uppercase text-brand-foreground"
              >
                <Plus aria-hidden="true" focusable="false" className="h-3.5 w-3.5" /> <span>Au devis</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {tireGroup ? (
        <div className="mt-3">
          <TireOfferGrid
            offers={tireGroup.offers}
            selectedSlot={tireGroup.selected_slot}
            {...(onSelectTire ? { onSelect: onSelectTire } : {})}
          />
        </div>
      ) : null}
    </div>
  );
}

export function QuoteBlocks({
  lines,
  onEdit,
  onAdd,
  onSelectTire,
}: {
  lines: DisplayLine[];
  onEdit?: (l: DisplayLine) => void;
  onAdd?: (l: DisplayLine) => void;
  onSelectTire?: (line: DisplayLine, offer: TireQuoteChoice) => void;
}) {
  const order: QuoteBlock[] = ["mecanique", "carrosserie", "esthetique"];
  const total = lines.filter((l) => !l.needsContact).reduce((s, l) => s + l.totalTtc, 0);

  return (
    <div className="space-y-4">
      {order.map((block) => {
        const rows = lines.filter((l) => l.block === block);
        if (!rows.length) return null;
        const sub = rows.filter((l) => !l.needsContact).reduce((s, l) => s + l.totalTtc, 0);
        return (
          <section key={block} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                {BLOCK_LABEL[block]}
              </h3>
              <span className="text-sm font-bold">
                {sub.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € TTC
              </span>
            </div>
            {rows.map((l, i) => (
              <QuoteLineRow
                key={l.id ?? `${block}-${i}`}
                line={l}
                {...(onEdit ? { onEdit: () => onEdit(l) } : {})}
                {...(onAdd ? { onAdd: () => onAdd(l) } : {})}
                {...(onSelectTire ? { onSelectTire: (offer) => onSelectTire(l, offer) } : {})}
              />
            ))}
          </section>
        );
      })}
      {lines.length ? (
        <div className="flex items-center justify-between rounded-xl bg-secondary px-4 py-3">
          <span className="text-sm font-bold uppercase tracking-wide">Total général</span>
          <span className="text-lg font-extrabold">
            {total.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € TTC
          </span>
        </div>
      ) : null}
    </div>
  );
}
