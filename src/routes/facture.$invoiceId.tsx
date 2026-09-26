import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/AppShell";
import { Badge, usePartsCtx } from "@/components/parts/PartsUi";
import { formatHours, lineTotals } from "@/lib/winmotor/invoices";
import { getInvoice } from "@/lib/winmotor/wm-data";

export const Route = createFileRoute("/facture/$invoiceId")({
  head: () => ({
    meta: [
      { title: "Facture WinMotor — DDA Connect" },
      { name: "description", content: "Facture WinMotor importée : lignes, totaux, OR et véhicule." },
      { property: "og:title", content: "Facture WinMotor — DDA Connect" },
      { property: "og:description", content: "Facture WinMotor importée." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InvoicePage,
});

const KIND: Record<string, string> = { package_header: "En-tête forfait", part: "Pièce", package_part: "Pièce forfait", labour: "MO", package_labour: "MO forfait", other: "Autre" };

function InvoicePage() {
  const { invoiceId } = Route.useParams();
  const { siteName } = usePartsCtx();
  const q = useQuery({ queryKey: ["wm-invoice", invoiceId], queryFn: () => getInvoice(invoiceId) });
  const i = q.data;
  const t = i ? lineTotals(i.lines) : null;
  return (
    <AppShell title={i ? `Facture ${i.invoice_number}` : "Facture"} subtitle="WinMotor" back={{ to: "/" }}>
      {!i ? <p className="text-sm text-muted-foreground">Chargement…</p> : (
        <div className="space-y-3">
          <div className="card-surface space-y-1 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-lg">{i.invoice_date ? new Date(i.invoice_date).toLocaleDateString("fr-FR") : "Date inconnue"}</b>
              <Badge tone="brand">{siteName(i.site_id)}</Badge>
              {i.doc_kind === "credit" ? <Badge tone="warn">Avoir</Badge> : i.doc_kind === "preinvoice" ? <Badge tone="warn">Préfacture</Badge> : null}
              {!i.has_header ? <Badge tone="warn">Entête non importée</Badge> : null}
              {!i.has_detail ? <Badge>Détail non importé</Badge> : null}
            </div>
            <div className="flex flex-wrap gap-3">
              {i.or_number ? (i.repair_order_id ? <Link to="/or/$orId" params={{ orId: i.repair_order_id }} className="font-bold underline">OR {i.or_number}</Link> : <span>OR {i.or_number}</span>) : null}
              {i.ref_vehicle_id ? <Link to="/vehicule/$vehId" params={{ vehId: i.ref_vehicle_id }} className="underline">{i.plate ?? "Véhicule"}</Link> : i.plate ? <span>{i.plate}</span> : null}
              {i.or_number ? <Link to="/pieces-achats/controle-winmotor" search={{ site: i.site_id, or: i.or_number }} className="underline">Contrôle WinMotor</Link> : null}
            </div>
            <div>Client : {i.customer_id ? <Link to="/client/$clientId" params={{ clientId: i.customer_id }} className="underline">{i.client_name ?? i.client_no}</Link> : (i.client_name ?? i.client_no ?? "—")}</div>
            {i.billed_client_no && i.billed_client_no !== i.client_no ? <div>Client facturé : {i.billed_customer_id ? <Link to="/client/$clientId" params={{ clientId: i.billed_customer_id }} className="underline">{i.billed_client_name ?? i.billed_client_no}</Link> : (i.billed_client_name ?? i.billed_client_no)}</div> : null}
            <div className="font-bold">
              {i.total_ht != null ? `HT ${Number(i.total_ht).toFixed(2)} € · TVA ${Number(i.total_tva ?? 0).toFixed(2)} € · TTC ${Number(i.total_ttc ?? 0).toFixed(2)} €` : t ? `Lignes HT ${t.ht.toFixed(2)} €` : ""}
            </div>
            {t?.hours ? <div>MO facturée : {formatHours(t.hours)} ({t.hours.toFixed(2)} h)</div> : null}
            {i.seller ? <div className="text-xs text-muted-foreground">Vendeur : {i.seller}</div> : null}
          </div>
          <section className="card-surface p-3">
            {i.lines.map((l) => (
              <div key={l.id} className={`flex justify-between gap-2 border-b border-border py-2 text-sm last:border-0 ${l.line_kind === "package_header" ? "font-extrabold" : ""}`}>
                <div className="min-w-0">
                  <div className="truncate">{l.designation ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{KIND[l.line_kind]}{l.reference ? ` · ${l.reference}` : ""}{l.vat_rate != null ? ` · TVA ${l.vat_rate} %` : l.vat_code ? ` · code TVA ${l.vat_code}` : ""}</div>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <div>{l.qty ?? ""}{l.line_kind.includes("labour") && l.qty ? " h" : ""}</div>
                  <div className="font-bold">{l.line_kind === "package_header" ? "titre" : l.net_ht != null ? `${Number(l.net_ht).toFixed(2)} €` : ""}</div>
                </div>
              </div>
            ))}
          </section>
        </div>
      )}
    </AppShell>
  );
}
