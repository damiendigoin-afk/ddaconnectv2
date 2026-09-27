import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { DocDropZone } from "@/components/parts/DocDropZone";
import { ActiveSiteNote, Badge, usePartsCtx, useSuppliers } from "@/components/parts/PartsUi";
import { listOrders } from "@/lib/parts";
import { guessDocumentSite, matchOrders, matchSupplier } from "@/lib/parts-site";
import { docSiteText, readPurchaseDoc } from "@/lib/purchase-doc";
import { fetchPendingSupplierDocs, fetchSupplierMails, statusLabel, uploadSupplierDoc } from "@/lib/supplier-docs";

export const Route = createFileRoute("/pieces-achats/documents")({
  head: () => ({
    meta: [
      { title: "Documents à traiter — DDA Connect" },
      { name: "description", content: "BL et factures fournisseur reçus par e-mail ou déposés, avec rapprochements probables." },
      { property: "og:title", content: "Documents à traiter — DDA Connect" },
      { property: "og:description", content: "File des documents fournisseurs à contrôler." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DocumentsPage,
});

function DocumentsPage() {
  const { readSite, writeSite, siteName, sites, actor } = usePartsCtx();
  const navigate = useNavigate();
  const suppliers = useSuppliers();
  const [busy, setBusy] = useState(false);
  const docs = useQuery({ queryKey: ["pending-docs", readSite], queryFn: () => fetchPendingSupplierDocs(readSite) });
  const mails = useQuery({ queryKey: ["supplier-mails", readSite, sites.length], queryFn: () => fetchSupplierMails(readSite, sites) });
  const orders = useQuery({ queryKey: ["open-orders-match", readSite], queryFn: () => listOrders({ siteId: readSite }) });

  async function onFile(file: File) {
    if (!writeSite) return void toast.error("Choisissez le site actif dans la barre du haut.");
    setBusy(true);
    try {
      const r = await readPurchaseDoc(file);
      if (r.warning) toast.warning(r.warning);
      const d = await uploadSupplierDoc({ file: r.file, extracted: r.extracted, siteId: writeSite, userId: actor.userId, userName: actor.name });
      void navigate({ to: "/pieces-achats/reception", search: { doc: d.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dépôt impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Documents à traiter" subtitle="Pièces & achats" back={{ to: "/pieces-achats" }}>
      <div className="space-y-4">
        <ActiveSiteNote />
        <DocDropZone title="Déposer un BL ou une facture" busy={busy} onFile={onFile} />

        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase text-muted-foreground">BL / factures à contrôler</h2>
          {docs.data && !docs.data.length ? <p className="card-surface p-3 text-sm text-muted-foreground">Aucun document en attente.</p> : null}
          {(docs.data ?? []).map((d) => {
            const x = d.extracted;
            const sup = matchSupplier(x.supplier, suppliers.data ?? []);
            const best = matchOrders(x, orders.data ?? [], d.site_id)[0];
            const docSite = guessDocumentSite(docSiteText(x), sites);
            return (
              <div key={d.id} className="rounded-xl border-2 border-border bg-card p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <b className="truncate">{sup?.name ?? x.supplier ?? d.file_name}</b>
                  <Badge tone="warn">{statusLabel(d.status)}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {x.doc_kind === "facture" ? "Facture" : "BL"} · {siteName(d.site_id)} · {new Date(d.created_at).toLocaleDateString("fr-FR")}
                  {x.or_number ? ` · OR ${x.or_number}` : ""}{x.plate ?? d.plate ? ` · ${x.plate ?? d.plate}` : ""}
                </div>
                {best ? <p className="text-xs">Commande {best.level === "certain" ? "trouvée" : "probable"} : {(best.order.suppliers as { name: string } | null)?.name ?? "?"}{best.order.plate ? ` · ${best.order.plate}` : ""}</p> : <p className="text-xs text-muted-foreground">Aucune commande DDA rapprochée.</p>}
                {docSite && d.site_id && docSite !== d.site_id ? <p className="text-xs font-bold">Semble appartenir à {siteName(docSite)}.</p> : null}
                <div className="mt-2 flex flex-wrap gap-3 text-xs font-extrabold uppercase">
                  <Link to="/pieces-achats/reception" search={{ doc: d.id }} className="underline">Contrôler / Réceptionner</Link>
                  <Link to="/factures-fournisseur" className="underline">Contrôle facture</Link>
                </div>
              </div>
            );
          })}
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase text-muted-foreground">Reçus par e-mail (fournisseurs)</h2>
          {mails.data && !mails.data.length ? <p className="card-surface p-3 text-sm text-muted-foreground">Aucun e-mail fournisseur avec pièce jointe en attente.</p> : null}
          {(mails.data ?? []).map((m) => (
            <div key={m.id} className="rounded-xl border-2 border-border bg-card p-3 text-sm">
              <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-brand" /><b className="truncate">{m.from_name ?? m.from_address}</b></div>
              <div className="text-xs text-muted-foreground">{new Date(m.sent_at).toLocaleDateString("fr-FR")} · {siteName(m.effective_site_id)}{m.detected_plate ? ` · ${m.detected_plate}` : ""}</div>
              <div className="truncate text-xs">{m.subject}</div>
              <div className="text-xs">{m.files.join(", ")}</div>
              <Link to="/emails" className="mt-1 inline-block text-xs font-extrabold uppercase underline">Ouvrir le mail</Link>
            </div>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
