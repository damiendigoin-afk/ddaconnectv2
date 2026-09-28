import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { btnGhost, btnPrimary, SupplierSelect, usePartsCtx } from "@/components/parts/PartsUi";
import { DocSupplierLink } from "@/components/parts/DocSupplierLink";
import { setOrderSupplier } from "@/lib/parts";
import type { InvoiceExtract } from "@/lib/supplier-docs";

type OrderLite = { id: string; site_id: string; status: string; supplier_id: string | null; source_document_id: string | null; suppliers?: { name: string } | null; inbox_documents?: { id: string; extracted: unknown } | null };

/** Fournisseur d'une commande : rattachement depuis le document source ou correction sur place. */
export function OrderSupplierFix({ o, compact }: { o: OrderLite; compact?: boolean }) {
  const { actor } = usePartsCtx();
  const qc = useQueryClient();
  const [open, setOpen] = useState(!compact);
  const [editing, setEditing] = useState(false);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const x = (o.inbox_documents?.extracted ?? null) as InvoiceExtract | null;
  const detected = !o.supplier_id && x?.supplier ? x.supplier : null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  async function save(id: string) {
    setBusy(true);
    try {
      await setOrderSupplier(o, id, actor);
      toast.success("Fournisseur rattaché à la commande");
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ["part-orders"] });
      void qc.invalidateQueries({ queryKey: ["part-order", o.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rattachement impossible");
    } finally {
      setBusy(false);
    }
  }

  if (o.status === "cancelled") return null;

  if (!o.supplier_id && !editing) {
    return (
      <div className="mt-2 space-y-2 rounded-lg border-2 border-status-watch bg-status-watch-soft p-2 text-xs" onClick={stop}>
        {detected ? (
          <>
            <p><b>Fournisseur détecté : {detected}</b> — pas encore rattaché à la commande.</p>
            {open ? (
              <>
                <DocSupplierLink extracted={x!} docId={o.source_document_id} onLinked={(id) => { if (id !== o.supplier_id) void save(id); }} />
                <button type="button" className="underline" onClick={() => setEditing(true)}>Choisir une autre fiche existante</button>
              </>
            ) : (
              <button type="button" className={btnPrimary} onClick={() => setOpen(true)}>Rattacher le fournisseur</button>
            )}
          </>
        ) : (
          <>
            <p className="font-bold">Fournisseur non renseigné.</p>
            <button type="button" className={btnGhost} onClick={() => setEditing(true)}>Choisir le fournisseur</button>
          </>
        )}
      </div>
    );
  }

  if (editing) {
    return (
      <div className="mt-2 space-y-2 rounded-lg border-2 border-border p-2 text-xs" onClick={stop}>
        <SupplierSelect value={pick} onChange={setPick} />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={btnGhost} onClick={() => setEditing(false)}>Retour</button>
          <button type="button" className={btnPrimary} disabled={!pick || busy} onClick={() => save(pick)}>Enregistrer</button>
        </div>
      </div>
    );
  }

  return (
    <button type="button" className="text-xs underline" onClick={(e) => { stop(e); setPick(o.supplier_id ?? ""); setEditing(true); }}>
      Modifier le fournisseur
    </button>
  );
}
