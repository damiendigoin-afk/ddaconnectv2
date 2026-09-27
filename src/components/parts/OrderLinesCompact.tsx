import { fmtEur } from "@/components/parts/PartsUi";
import { pendingOrderLineMetrics, type PendingOrderLine } from "@/lib/receipt-lines";

export function OrderLinesCompact({ lines }: { lines: PendingOrderLine[] }) {
  const parts = lines.filter((line) => line.line_kind === "part");
  if (!parts.length) return <p className="mt-2 text-xs text-muted-foreground">Contenu non détaillé.</p>;

  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="hidden grid-cols-[1.15fr_2fr_0.55fr_0.55fr_0.55fr_0.8fr] gap-2 px-1 text-[10px] font-extrabold uppercase text-muted-foreground md:grid">
        <span>Référence</span><span>Désignation</span><span>Commandée</span><span>Reçue</span><span>Reliquat</span><span>PA HT</span>
      </div>
      <div className="space-y-1">
        {parts.map((line, index) => {
          const qty = pendingOrderLineMetrics(line);
          return (
            <div key={line.id ?? `${line.physical_reference}-${index}`} className="grid grid-cols-2 gap-x-2 gap-y-1 rounded-md border border-border bg-background p-2 text-xs md:grid-cols-[1.15fr_2fr_0.55fr_0.55fr_0.55fr_0.8fr] md:items-center md:border-0 md:border-t md:bg-transparent md:px-1 md:py-1.5">
              <span className="font-bold">{line.physical_reference || "—"}</span>
              <span className="col-span-2 min-w-0 md:col-span-1">{line.designation || "—"}</span>
              <span><span className="text-muted-foreground md:hidden">Commandée : </span>{qty.ordered ?? "?"}</span>
              <span><span className="text-muted-foreground md:hidden">Reçue : </span>{qty.received}</span>
              <span className="font-bold"><span className="text-muted-foreground md:hidden">Reliquat : </span>{qty.remaining ?? "?"}</span>
              <span><span className="text-muted-foreground md:hidden">PA HT : </span>{fmtEur(line.expected_unit_cost_ht)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}