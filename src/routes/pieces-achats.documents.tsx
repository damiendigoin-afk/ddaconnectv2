import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { DocDropZone } from "@/components/parts/DocDropZone";
import { ActiveSiteNote, Badge, usePartsCtx, useSuppliers } from "@/components/parts/PartsUi";
import { listOrders } from "@/lib/parts";
import { guessDocumentSite, matchOrders, matchSupplier } from "@/lib/parts-site";
import { docSiteText, readPurchaseDoc } from "@/lib/purchase-doc";
import { fetchPendingSupplierDocs, fetchSupplierMails, importEmailAttachment, statusLabel, uploadSupplierDoc, type MailAttachment, type SupplierMail } from "@/lib/supplier-docs";
import { fetchEmailAttachment } from "@/lib/email-attachment.functions";
import { importDestination } from "@/lib/supplier-mail-filter";
import { mailDetail, previewAttachment } from "@/lib/receipt-lines";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  const [importing, setImporting] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const fetchFile = useServerFn(fetchEmailAttachment);
  const [openMail, setOpenMail] = useState<SupplierMail | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);

  async function onPreview(a: MailAttachment) {
    // Ouvre la fenêtre tout de suite (évite le bloqueur de pop-up), puis y charge le fichier.
    const win = window.open("", "_blank");
    setPreviewing(a.id);
    try {
      const r = await previewAttachment((id) => fetchFile({ data: { attachmentId: id } }), a.id, (blob) => {
        const url = URL.createObjectURL(blob);
        if (win) win.location.href = url; else window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      });
      if (!r.ok) { win?.close(); toast.error(r.message); }
    } catch (e) {
      win?.close();
      toast.error(e instanceof Error ? e.message : "Ouverture impossible");
    } finally {
      setPreviewing(null);
    }
  }

  const attRow = (m: SupplierMail, a: MailAttachment) => (
    <div key={a.id} className="flex flex-wrap items-center gap-2 text-xs">
      <button type="button" onClick={() => onPreview(a)} disabled={previewing === a.id} className="truncate text-left font-bold text-brand underline">{previewing === a.id ? "Ouverture…" : a.filename}</button>
      {a.imported_doc_id ? (
        <Link to="/pieces-achats/reception" search={{ doc: a.imported_doc_id }} className="font-extrabold uppercase underline">Déjà ajouté</Link>
      ) : failed[a.id] ? (
        <span className="font-bold text-destructive">{failed[a.id]}</span>
      ) : (
        <button type="button" disabled={importing !== null} onClick={() => onImport(m, a)} className="rounded-md border-2 border-border px-2 py-0.5 font-extrabold uppercase">
          {importing === a.id ? "Ajout…" : "Ajouter à DDA"}
        </button>
      )}
    </div>
  );

  async function onImport(m: SupplierMail, a: MailAttachment) {
    const siteId = m.effective_site_id ?? writeSite;
    if (!siteId) return void toast.error("Site ambigu : choisissez le site actif dans la barre du haut.");
    setImporting(a.id);
    try {
      const r = await importEmailAttachment({ mail: m, attachment: a, siteId, userId: actor.userId, userName: actor.name, fetchFile: (id) => fetchFile({ data: { attachmentId: id } }), read: readPurchaseDoc });
      if (r.existing) { toast.info("Déjà ajouté à DDA."); void navigate({ to: "/pieces-achats/reception", search: { doc: r.existing } }); return; }
      if (r.error || !r.doc) { setFailed((f) => ({ ...f, [a.id]: r.error ?? "Import impossible" })); return; }
      if (r.warning) toast.warning(r.warning);
      toast.success(`${a.filename} ajouté à DDA`);
      void qc.invalidateQueries({ queryKey: ["supplier-mails"] });
      void qc.invalidateQueries({ queryKey: ["pending-docs"] });
      const dest = importDestination(r.doc.extracted.doc_kind);
      if (dest === "reception") void navigate({ to: "/pieces-achats/reception", search: { doc: r.doc.id } });
      else if (dest === "facture") void navigate({ to: "/factures-fournisseur" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import impossible");
    } finally {
      setImporting(null);
    }
  }
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
              <div className="mt-1 space-y-1">
                {m.attachments.map((a) => attRow(m, a))}
              </div>
              <button type="button" onClick={() => setOpenMail(m)} className="mt-1 inline-block text-xs font-extrabold uppercase underline">Ouvrir le mail</button>
            </div>
          ))}
        </section>
      </div>
      <Dialog open={!!openMail} onOpenChange={(o) => !o && setOpenMail(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          {openMail ? (() => { const d = mailDetail(openMail); return (
            <>
              <DialogHeader><DialogTitle>{d.subject}</DialogTitle></DialogHeader>
              <div className="space-y-1 text-xs">
                <p><b>De :</b> {d.from}</p>
                <p><b>Date :</b> {d.date}</p>
                {d.to ? <p><b>À :</b> {d.to}</p> : null}
                {d.cc ? <p><b>Cc :</b> {d.cc}</p> : null}
              </div>
              <pre className="whitespace-pre-wrap break-words rounded-lg border-2 border-border bg-muted p-3 font-sans text-sm">{d.body}</pre>
              <div className="space-y-1"><p className="text-xs font-bold uppercase text-muted-foreground">Pièces jointes</p>{openMail.attachments.map((a) => attRow(openMail, a))}</div>
            </>
          ); })() : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
