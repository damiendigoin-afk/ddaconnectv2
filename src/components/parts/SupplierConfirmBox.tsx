/** Commande « à transmettre » : saisie du n° de commande fournisseur réel (seule voie vers « Commandée »). */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import { confirmSupplierOrder } from "@/lib/tire-supplier-order-db";
import { validateSupplierConfirmation } from "@/lib/tire-supplier-order";

export function SupplierConfirmBox({ o }: { o: { id: string; site_id: string; supplier_account?: string | null; source_quote?: { product_url?: string | null } | null } }) {
  const { user, displayName } = useAuth();
  const qc = useQueryClient();
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const url = o.source_quote?.product_url ?? null;
  async function save() {
    const err = validateSupplierConfirmation(ref);
    if (err) return toast.error(err);
    setBusy(true);
    try {
      await confirmSupplierOrder(o.id, o.site_id, ref, { userId: user?.id ?? null, name: displayName ?? "" });
      toast.success("Commande confirmée chez le fournisseur.");
      await qc.invalidateQueries({ queryKey: ["part-order", o.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border p-3">
      <p className="text-xs">
        Pas encore commandée chez le fournisseur{o.supplier_account ? ` (compte ${o.supplier_account})` : ""}. Passez la commande sur le portail, puis saisissez le n° de commande reçu. Le document de confirmation se joint ensuite via l'import de documents.
      </p>
      {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold underline">Voir chez Districash ↗</a> : null}
      <div className="flex gap-2">
        <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="N° de commande Districash" className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm" />
        <button type="button" disabled={busy} onClick={() => void save()} className="h-10 rounded-lg bg-brand px-3 text-xs font-bold uppercase text-brand-foreground disabled:opacity-50">Confirmer</button>
      </div>
    </div>
  );
}
