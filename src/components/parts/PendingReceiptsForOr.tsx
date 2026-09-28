import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PackageCheck } from "lucide-react";
import { toast } from "sonner";

import { btnPrimary, usePartsCtx } from "@/components/parts/PartsUi";
import { attachReceiptToOr, listOrphanReceiptsForPlate } from "@/lib/parts";
import { formatPlate } from "@/lib/plate";

type Line = { id: string; physical_reference: string | null; designation: string | null; qty_received: number; condition: string };
type Rec = { id: string; received_at: string; received_by_name: string | null; supplier_order_ref: string | null; free_reference: string | null; suppliers: { name: string } | null; inbox_documents: { extracted: Record<string, unknown> | null } | null; part_receipt_lines: Line[] };

/** Réceptions validées sans OR pour la même immatriculation : proposées, jamais rattachées sans confirmation. */
export function PendingReceiptsForOr({ or, plate }: { or: { id: string; or_number: string | null; site_id: string | null; vehicle_id: string | null }; plate: string | null }) {
  const { actor } = usePartsCtx();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["orphan-receipts", or.site_id, plate], enabled: !!plate && !!or.or_number, queryFn: () => listOrphanReceiptsForPlate(or.site_id, plate) });
  const rows = (q.data ?? []) as unknown as Rec[];
  if (!rows.length) return null;

  async function attach(r: Rec) {
    if (!window.confirm(`Rattacher la réception ${r.suppliers?.name ?? ""} du ${new Date(r.received_at).toLocaleString("fr-FR")} à l'OR ${or.or_number} ? Les pièces utilisables seront affectées à cet OR (à pointer).`)) return;
    setBusy(r.id);
    try {
      const res = await attachReceiptToOr(r.id, or, actor);
      toast.success(`Réception rattachée à l'OR ${or.or_number} — ${res.allocated} pièce(s) à pointer`);
      for (const k of ["orphan-receipts", "or-usage", "or-parts", "or-state"]) void qc.invalidateQueries({ queryKey: [k] });
      void qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rattachement impossible");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border-2 border-status-watch bg-status-watch-soft p-3">
      <div className="flex items-center gap-2 text-sm font-extrabold uppercase"><PackageCheck className="h-4 w-4" /> Réception(s) en attente pour {formatPlate(plate ?? "")}</div>
      <p className="text-xs text-muted-foreground">Pièces déjà reçues au magasin pour cette immatriculation, sans OR. Vérifiez puis rattachez-les pour pouvoir les pointer.</p>
      {rows.map((r) => {
        const bl = (r.inbox_documents?.extracted?.["document_number"] as string | undefined) ?? null;
        return (
          <div key={r.id} className="space-y-1 rounded-lg border border-border bg-card p-3 text-sm">
            <div className="font-bold">{r.suppliers?.name ?? "Fournisseur ?"} · {new Date(r.received_at).toLocaleString("fr-FR")}</div>
            <div className="text-xs text-muted-foreground">{[bl && `BL ${bl}`, r.supplier_order_ref && `Cde ${r.supplier_order_ref}`, r.free_reference && `Repère ${r.free_reference}`, r.received_by_name && `reçu par ${r.received_by_name}`].filter(Boolean).join(" · ")}</div>
            <ul className="text-xs">
              {r.part_receipt_lines.map((l) => (
                <li key={l.id}>{l.physical_reference ?? "sans réf."} — {l.designation ?? ""} × {l.qty_received}{l.condition !== "usable" ? " (non utilisable)" : ""}</li>
              ))}
            </ul>
            <button className={btnPrimary} disabled={busy === r.id} onClick={() => void attach(r)}>Rattacher cette réception à l'OR {or.or_number}</button>
          </div>
        );
      })}
    </div>
  );
}
