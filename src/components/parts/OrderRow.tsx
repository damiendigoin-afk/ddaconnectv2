import { Link } from "@tanstack/react-router";

import { orderMarker } from "@/lib/receipt-lines";
import { Badge, ORDER_STATUS } from "@/components/parts/PartsUi";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function OrderRow({ o, siteName }: { o: any; siteName: (id: string) => string }) {
  const lines = ((o.part_order_lines ?? []) as { line_kind: string; status: string }[]).filter((l) => l.line_kind === "part");
  const st = ORDER_STATUS[o.status as string] ?? ORDER_STATUS["ordered"]!;
  return (
    <Link to="/pieces-achats/commande/$orderId" params={{ orderId: o.id }} className="block rounded-xl border-2 border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-extrabold">{o.suppliers?.name ?? "Fournisseur à préciser"}</span>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <div className="text-xs text-muted-foreground">
        {siteName(o.site_id)} · {new Date(o.created_at).toLocaleDateString("fr-FR")}
        {` · ${orderMarker(o)}`}
        {o.appointment_date ? ` · RDV ${new Date(o.appointment_date).toLocaleDateString("fr-FR")}` : ""}
      </div>
      <div className="mt-1 text-xs">
        {lines.length ? `${lines.length} ligne(s) · ${lines.filter((l) => l.status === "received").length} reçue(s)` : <Badge tone="warn">Commande non détaillée</Badge>}
      </div>
    </Link>
  );
}

