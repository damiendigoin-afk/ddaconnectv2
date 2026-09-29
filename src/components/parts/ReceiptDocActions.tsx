import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { DocDropZone } from "@/components/parts/DocDropZone";
import type { Actor } from "@/lib/parts";
import { attachDocToReceipt, type ReceiptDocRow, type ReceiptForDoc } from "@/lib/receipt-docs";
import { DOC_KIND_LABEL, receiptDocKind } from "@/lib/receipt-docs-rules";
import { supplierDocUrl } from "@/lib/supplier-docs";

/** Actions documentaires d'une réception existante : ajouter BL/facture, voir les documents. */
export function ReceiptDocActions({ receipt, docs, actor }: { receipt: ReceiptForDoc; docs: ReceiptDocRow[]; actor: Actor }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    try {
      const res = await attachDocToReceipt(receipt, file, actor);
      toast.success(`${DOC_KIND_LABEL[res.kind]} rattaché(e) à la réception — stock inchangé`);
      if (res.readWarning) toast.warning(res.readWarning);
      for (const w of res.warnings) toast.warning(`À vérifier : ${w}`);
      setOpen(false);
      setShow(true);
      void qc.invalidateQueries({ queryKey: ["part-receipts"] });
      void qc.invalidateQueries({ queryKey: ["receipt-docs"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rattachement impossible");
    } finally {
      setBusy(false);
    }
  }

  async function openDoc(d: ReceiptDocRow) {
    const url = await supplierDocUrl(d.storage_path);
    if (url) window.open(url, "_blank", "noopener");
    else toast.error("Document introuvable");
  }

  return (
    <>
      <button className="ml-3 text-xs font-bold underline" onClick={() => setOpen((v) => !v)}>Ajouter BL / facture</button>
      {docs.length ? <button className="ml-3 text-xs underline" onClick={() => setShow((v) => !v)}>Voir document(s) ({docs.length})</button> : null}
      {show && docs.length ? (
        <ul className="mt-2 space-y-1 text-xs">
          {docs.map((d) => {
            const x = d.extracted ?? {};
            const num = x.document_number ?? x.invoice_number ?? x.delivery_note_number;
            const date = x.document_date ?? x.invoice_date;
            return (
              <li key={d.id}>
                <button className="underline" onClick={() => void openDoc(d)}>{DOC_KIND_LABEL[receiptDocKind(x)]}{num ? ` ${num}` : ""}</button>
                {date ? ` · ${date}` : ""}{x.supplier ? ` · ${x.supplier}` : ""}{x.total_ht != null ? ` · ${x.total_ht} € HT` : ""} · <span className="text-muted-foreground">{d.file_name}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {open ? (
        <div className="mt-2">
          <DocDropZone title="BL ou facture de cette réception" hint="Rattaché à cette réception uniquement — aucune nouvelle réception, stock inchangé" busy={busy} onFile={onFile} />
        </div>
      ) : null}
    </>
  );
}
