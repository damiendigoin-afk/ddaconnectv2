import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { orderMarker } from "@/lib/receipt-lines";
import { Badge, LogisticsBadge, ORDER_STATUS, usePartsCtx } from "@/components/parts/PartsUi";
import { OrderLinesCompact } from "@/components/parts/OrderLinesCompact";
import { CancelAction } from "@/components/parts/CancelAction";
import { cancelOrder } from "@/lib/parts";
import { OrderSupplierFix } from "@/components/parts/OrderSupplierFix";
import { SourceDocButton } from "@/components/parts/SourceDocButton";
import type { PendingOrderLine } from "@/lib/receipt-lines";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function OrderRow({ o, siteName }: { o: any; siteName: (id: string) => string }) {
  const { actor } = usePartsCtx();
  const qc = useQueryClient();
  const lines = ((o.part_order_lines ?? []) as PendingOrderLine[]).filter((l) => l.line_kind === "part");
  const st = ORDER_STATUS[o.status as string] ?? ORDER_STATUS["ordered"]!;
  const received = lines.reduce((s, l) => s + Number(l.qty_received ?? 0), 0);
  const cancellable = o.status === "ordered" || o.status === "partial";
  return (
    <div className="rounded-xl border-2 border-border bg-card p-3">
      <Link to="/pieces-achats/commande/$orderId" params={{ orderId: o.id }} className="block">
        <div className="flex items-center justify-between gap-2">
          <span className="font-extrabold">{o.suppliers?.name ?? (o.inbox_documents?.extracted?.supplier ? `${o.inbox_documents.extracted.supplier} (à rattacher)` : "Fournisseur non renseigné")}</span>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          {siteName(o.site_id)} · {new Date(o.created_at).toLocaleDateString("fr-FR")}
          {` · ${orderMarker(o)}`}
        </div>
        {o.appointment_date ? (
          <div className="text-xs font-extrabold">RDV {new Date(o.appointment_date).toLocaleDateString("fr-FR")}</div>
        ) : null}
        <LogisticsBadge order={o} />
        {lines.length ? <OrderLinesCompact lines={lines} /> : <div className="mt-2"><Badge tone="warn">Commande non détaillée</Badge></div>}
      </Link>
      <SourceDocButton o={o} compact />
      {o.status !== "cancelled" ? <Link to="/pieces-achats/commande/$orderId" params={{ orderId: o.id }} search={{ edit: 1 }} className="mr-3 text-xs font-bold underline">Modifier</Link> : null}
      <OrderSupplierFix o={o} compact />
      {o.status === "cancelled" && o.cancel_reason ? <p className="mt-1 text-xs font-bold">Annulée par {o.cancelled_by_name ?? "?"} — {o.cancel_reason}</p> : null}
      {cancellable ? (
        <div className="-ml-3 mt-1">
          <CancelAction
            label="Annuler la commande"
            warning={received > 0
              ? `${received} pièce(s) déjà reçue(s) : seules les quantités encore en attente seront annulées. Les réceptions restent enregistrées (pour les annuler, utilisez « Annuler la réception »).`
              : "Annuler cette commande ? Elle disparaîtra des commandes à recevoir. L'historique est conservé."}
            onConfirm={async (why) => {
              await cancelOrder(o.id, why, actor);
              void qc.invalidateQueries({ queryKey: ["part-orders"] });
              return "Commande annulée";
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
