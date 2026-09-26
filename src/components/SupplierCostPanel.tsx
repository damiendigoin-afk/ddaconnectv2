import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import type { SupplierDoc } from "@/lib/supplier-docs";
import {
  COST_STATUS_LABEL,
  controlSupplierInvoiceCosts,
  fetchCostLines,
  linkCostLine,
  receiptCandidates,
  validatePriceAlert,
} from "@/lib/supplier-cost";

/** Coût réel : aucune quantité de stock n'est modifiée depuis ce panneau. */
export function SupplierCostPanel({ doc }: { doc: SupplierDoc }) {
  const { user, displayName } = useAuth();
  const actor = { userId: user?.id ?? null, name: displayName ?? "Utilisateur" };
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["supplier-cost", doc.id], queryFn: () => fetchCostLines(doc.id) });
  const pickLine = q.data?.find((l) => l.id === pick);
  const cands = useQuery({
    queryKey: ["supplier-cost-cands", pick],
    enabled: !!pickLine && !!doc.site_id,
    queryFn: () => receiptCandidates(doc.site_id!, [pickLine?.physical_reference ?? ""]),
  });

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: ["supplier-cost", doc.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  const canControl = doc.status === "valide" || doc.status === "lie_or";

  return (
    <div className="space-y-2 rounded-lg border-2 border-border p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-extrabold uppercase">Coût réel</span>
        <button
          disabled={busy || !canControl}
          onClick={() =>
            void run(async () => {
              const r = await controlSupplierInvoiceCosts(doc, actor);
              return r;
            }, "Coûts contrôlés")
          }
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-extrabold uppercase text-brand-foreground disabled:opacity-50"
        >
          Contrôler les coûts
        </button>
      </div>
      {!canControl ? <p className="text-xs text-muted-foreground">Validez d'abord la facture pour contrôler les coûts.</p> : null}
      <p className="text-[11px] text-muted-foreground">Le stock (quantités) ne bouge jamais ici. Écart ≤ 1 € par ligne validé automatiquement.</p>
      {(q.data ?? []).map((l) => (
        <div key={l.id} className="rounded border border-border p-2 text-xs">
          <div className="flex justify-between gap-2">
            <span className="font-bold">{l.physical_reference ?? "—"} · {l.qty ?? "?"} × {l.unit_price_ht ?? "?"} € HT</span>
            <span className={l.status === "price_alert" || l.status === "unmatched" ? "font-bold text-destructive" : "text-muted-foreground"}>
              {COST_STATUS_LABEL[l.status] ?? l.status}
            </span>
          </div>
          {l.reference_cost != null ? <div className="text-muted-foreground">Prix réception : {l.reference_cost} € · écart {l.gap_abs ?? 0} €</div> : null}
          {l.status === "applied" && l.pamp_after != null ? <div className="text-muted-foreground">PAMP {l.pamp_before ?? "—"} → {l.pamp_after}</div> : null}
          {l.status === "price_alert" ? (
            <button disabled={busy} onClick={() => void run(() => validatePriceAlert(l.id, doc.id, doc.extracted.invoice_date ?? null, actor), "Coût validé")} className="mt-1 rounded border-2 border-border px-2 py-1 font-extrabold uppercase">
              Valider ce prix
            </button>
          ) : null}
          {l.status === "unmatched" ? (
            <button onClick={() => setPick(pick === l.id ? null : l.id)} className="mt-1 rounded border-2 border-border px-2 py-1 font-extrabold uppercase">
              Choisir la réception
            </button>
          ) : null}
          {pick === l.id ? (
            <div className="mt-1 space-y-1">
              {(cands.data ?? []).length === 0 ? <div className="text-muted-foreground">Aucune réception trouvée pour cette référence sur ce site.</div> : null}
              {(cands.data ?? []).map((c) => (
                <button key={c.id} disabled={busy} onClick={() => void run(() => linkCostLine(l.id, c.id, doc, actor), "Ligne reliée")} className="block w-full rounded border border-border px-2 py-1 text-left">
                  {c.part_receipts?.received_at?.slice(0, 10)} · {c.part_receipts?.suppliers?.name ?? "Fournisseur ?"} · qté {c.qty_received} · {c.unit_cost_provisional ?? "—"} €{c.unit_cost_real != null ? ` (déjà valorisée ${c.unit_cost_real} €)` : ""}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
