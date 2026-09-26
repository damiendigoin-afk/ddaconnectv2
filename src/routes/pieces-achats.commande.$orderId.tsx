import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/AppShell";
import { Badge, fmtEur, ORDER_STATUS, OrLink, usePartsCtx } from "@/components/parts/PartsUi";
import { getOrder } from "@/lib/parts";

export const Route = createFileRoute("/pieces-achats/commande/$orderId")({
  head: () => ({
    meta: [
      { title: "Commande pièces — DDA Connect" },
      { name: "description", content: "Détail d'une commande fournisseur : lignes, reliquat, réceptions." },
      { property: "og:title", content: "Commande pièces — DDA Connect" },
      { property: "og:description", content: "Détail d'une commande fournisseur." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrderDetail,
});

function OrderDetail() {
  const { orderId } = Route.useParams();
  const { siteName } = usePartsCtx();
  const q = useQuery({ queryKey: ["part-order", orderId], queryFn: () => getOrder(orderId) });
  const o = q.data;
  return (
    <AppShell title="Commande" subtitle="Pièces & achats" back={{ to: "/pieces-achats/commandes" }}>
      {!o ? <p className="text-sm text-muted-foreground">Chargement…</p> : (
        <div className="space-y-3">
          <div className="card-surface space-y-1 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-lg font-extrabold">{(o.suppliers as { name: string } | null)?.name}</span>
              <Badge tone={(ORDER_STATUS[o.status] ?? ORDER_STATUS["ordered"]!).tone}>{(ORDER_STATUS[o.status] ?? ORDER_STATUS["ordered"]!).label}</Badge>
            </div>
            <div>{siteName(o.site_id)} · {o.order_mode === "simplified" ? "Simplifiée" : "Détaillée"} · créée le {new Date(o.created_at).toLocaleString("fr-FR")} par {o.created_by_name}</div>
            <div className="flex flex-wrap gap-2">
              <OrLink id={o.repair_order_id} num={(o.repair_orders as { or_number: string | null } | null)?.or_number} />
              {o.plate ? <span>{o.plate}</span> : null}
              {o.appointment_date ? <Badge tone="warn">RDV {new Date(o.appointment_date).toLocaleDateString("fr-FR")}</Badge> : null}
              {o.supplier_order_ref ? <span>Réf. fournisseur {o.supplier_order_ref}</span> : null}
            </div>
            {o.comment ? <p className="text-muted-foreground">{o.comment}</p> : null}
          </div>
          <Link to="/pieces-achats/reception" search={{ order: o.id }} className="block rounded-lg bg-brand py-3 text-center text-sm font-extrabold uppercase text-brand-foreground">
            Réceptionner cette commande
          </Link>
          <section className="card-surface p-4">
            <h2 className="mb-2 text-xs font-bold uppercase text-muted-foreground">Lignes</h2>
            {!(o.part_order_lines ?? []).length ? <Badge tone="warn">Commande non détaillée — contenu non détaillé / complétude inconnue</Badge> : null}
            {(o.part_order_lines ?? []).map((l) => (
              <div key={l.id} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
                <div>
                  <div className="font-bold">{l.physical_reference ?? "—"} {l.line_kind !== "part" ? <Badge>{l.line_kind === "fee" ? "Frais" : "Consigne"}</Badge> : null}</div>
                  <div className="text-xs text-muted-foreground">{l.designation} · {fmtEur(l.expected_unit_cost_ht)}</div>
                </div>
                <div className="text-right text-xs">
                  <div>{l.qty_received}/{l.qty_ordered ?? "?"} reçue(s)</div>
                  {l.qty_ordered != null && l.qty_received < l.qty_ordered && l.line_kind === "part" ? <Badge tone="warn">Reliquat {l.qty_ordered - l.qty_received}</Badge> : null}
                </div>
              </div>
            ))}
          </section>
          <section className="card-surface p-4">
            <h2 className="mb-2 text-xs font-bold uppercase text-muted-foreground">Réceptions</h2>
            {!o.receipts.length ? <p className="text-sm text-muted-foreground">Aucune réception.</p> : null}
            {o.receipts.map((r) => (
              <div key={r.id} className="text-sm">{new Date(r.received_at).toLocaleString("fr-FR")} · {r.received_by_name} {r.receipt_type === "physical_without_document" ? <Badge tone="warn">Sans document</Badge> : null}</div>
            ))}
          </section>
        </div>
      )}
    </AppShell>
  );
}
