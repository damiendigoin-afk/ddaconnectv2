import { fmtEur } from "@/components/parts/PartsUi";
import { pendingOrderLineMetrics, type PendingOrderLine } from "@/lib/receipt-lines";
import { lineShipDisplay, SHIP_STATUS_LABEL } from "@/lib/shipment-rules";
import { simplifiedOrderMeta } from "@/lib/parts-site";

type OrderMeta = { order_mode?: string | null; comment?: string | null; created_by_name?: string | null; created_at?: string | null };

function SimplifiedMetaLine({ order }: { order: OrderMeta }) {
  const meta = simplifiedOrderMeta(order);
  if (!meta.hasMeta) return null;
  return (
    <div className="mt-2 border-t border-border pt-2">
      {meta.comment ? <p className="text-sm font-semibold">Commentaire : {meta.comment}</p> : null}
      {meta.createdBy ? <p className="mt-0.5 text-xs text-muted-foreground">Créée par {meta.createdBy}{meta.when ? ` · ${meta.when}` : ""}</p> : null}
    </div>
  );
}

export function OrderLinesCompact({ lines, order }: { lines: PendingOrderLine[]; order?: OrderMeta | null }) {
  const parts = lines.filter((line) => line.line_kind === "part");
  const simplified = order?.order_mode === "simplified";
  if (!parts.length) {
    // Commande simplifiée : commentaire / créateur / heure sont l'information principale, jamais remplacés par « Contenu non détaillé ».
    if (simplified && simplifiedOrderMeta(order!).hasMeta) return <SimplifiedMetaLine order={order!} />;
    return <p className="mt-2 text-xs text-muted-foreground">Contenu non détaillé.</p>;
  }

  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="hidden grid-cols-[1.15fr_2fr_0.55fr_0.55fr_0.55fr_0.55fr_0.8fr] gap-2 px-1 text-[10px] font-extrabold uppercase text-muted-foreground md:grid">
        <span>Référence</span><span>Désignation</span><span>Commandée</span><span>Expédiée</span><span>Reçue</span><span>Reliquat</span><span>PA HT</span>
      </div>
      <div className="space-y-1">
        {parts.map((line, index) => {
          const qty = pendingOrderLineMetrics(line);
          return (
            <div key={line.id ?? `${line.physical_reference}-${index}`} className="grid grid-cols-2 gap-x-2 gap-y-1 rounded-md border border-border bg-background p-2 text-xs md:grid-cols-[1.15fr_2fr_0.55fr_0.55fr_0.55fr_0.55fr_0.8fr] md:items-center md:border-0 md:border-t md:bg-transparent md:px-1 md:py-1.5">
              <span className="font-bold">{line.physical_reference || "—"}</span>
              <span className="col-span-2 min-w-0 md:col-span-1">{line.designation || "—"}</span>
              <span><span className="text-muted-foreground md:hidden">Commandée : </span>{qty.ordered ?? "?"}</span>
              <span><span className="text-muted-foreground md:hidden">Expédiée : </span>{Number(line.qty_shipped ?? 0)}{lineShipDisplay(line) === "shipped" ? <b className="text-status-warn"> · {SHIP_STATUS_LABEL.shipped}</b> : null}</span>
              <span><span className="text-muted-foreground md:hidden">Reçue : </span>{qty.received}</span>
              <span className="font-bold"><span className="text-muted-foreground md:hidden">Reliquat : </span>{qty.remaining ?? "?"}</span>
              <span><span className="text-muted-foreground md:hidden">PA HT : </span>{fmtEur(line.expected_unit_cost_ht)}</span>
            </div>
          );
        })}
      </div>
      {simplified ? <SimplifiedMetaLine order={order!} /> : null}
    </div>
  );
}
