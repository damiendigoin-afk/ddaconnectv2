import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Receipt } from "lucide-react";

import { useSite } from "@/lib/site-context";
import { invoicesForCustomer, invoicesForVehicle, lineSummaries } from "@/lib/winmotor/wm-data";

type Target = { kind: "vehicle"; id: string; registration_normalized: string | null; vin_normalized: string | null } | { kind: "customer"; id: string };

/** Historique des passages facturés WinMotor (paginé 20 par 20). */
export function InvoiceTimeline({ target }: { target: Target }) {
  const [page, setPage] = useState(0);
  const { sites } = useSite();
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? "";
  const q = useQuery({
    queryKey: ["wm-timeline", target.kind, target.id, page],
    queryFn: async () => {
      const rows = target.kind === "vehicle" ? await invoicesForVehicle(target, page) : await invoicesForCustomer(target.id, page);
      const sums = await lineSummaries(rows.map((r) => r.id));
      return { rows, sums };
    },
  });
  const rows = q.data?.rows ?? [];
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Historique WinMotor (factures)</h2>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
      {!q.isLoading && !rows.length && page === 0 ? <p className="card-surface p-3 text-sm text-muted-foreground">Aucune facture WinMotor importée pour l'instant.</p> : null}
      {rows.map((r) => (
        <div key={r.id} className="rounded-xl border-2 border-border bg-card p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-extrabold">{r.invoice_date ? new Date(r.invoice_date).toLocaleDateString("fr-FR") : "Date inconnue"}</span>
            <span className="font-bold">{r.total_ttc != null ? `${Number(r.total_ttc).toFixed(2)} € TTC` : r.lines_net_ht != null ? `${Number(r.lines_net_ht).toFixed(2)} € HT` : ""}</span>
          </div>
          <div className="flex flex-wrap gap-x-3 text-xs">
            <Link to="/facture/$invoiceId" params={{ invoiceId: r.id }} className="inline-flex items-center gap-1 font-bold underline">
              <Receipt className="h-3 w-3" /> {r.doc_kind === "credit" ? "Avoir" : r.doc_kind === "preinvoice" ? "Préfacture" : "Facture"} {r.invoice_number}
            </Link>
            {r.or_number ? (r.repair_order_id ? <Link to="/or/$orId" params={{ orId: r.repair_order_id }} className="underline">OR {r.or_number}</Link> : <span>OR {r.or_number}</span>) : null}
            <span className="font-bold uppercase text-brand">{siteName(r.site_id)}</span>
            {target.kind === "customer" && r.plate ? <span>{r.plate}</span> : null}
            {r.billed_client_no && r.client_no && r.billed_client_no !== r.client_no ? <span>Facturé à {r.billed_client_name ?? r.billed_client_no}</span> : null}
          </div>
          {q.data?.sums.get(r.id) ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{q.data.sums.get(r.id)}</p> : !r.has_detail ? <p className="mt-1 text-xs text-muted-foreground">Détail non importé</p> : null}
        </div>
      ))}
      {rows.length === 20 || page > 0 ? (
        <div className="flex justify-between text-xs">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="underline disabled:opacity-40">Plus récents</button>
          <button disabled={rows.length < 20} onClick={() => setPage((p) => p + 1)} className="underline disabled:opacity-40">Plus anciens</button>
        </div>
      ) : null}
    </section>
  );
}
