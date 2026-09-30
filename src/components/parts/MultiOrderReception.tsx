import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge, btnPrimary, inputCls, usePartsCtx } from "@/components/parts/PartsUi";
import { validateMultiReceipt } from "@/lib/parts";
import { dispatchDocLines, multiReceiptPayloads, PRICE_GAP_LABEL, type MoDoc, type MoOrder } from "@/lib/multi-order-reception";

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

/** BL regroupant plusieurs commandes : répartition ligne par ligne, confirmation puis réception en une action. */
export function MultiOrderReception({ doc, docId, blNumber, orders, onDone }: { doc: MoDoc & { supplier_id: string }; docId: string; blNumber: string | null; orders: MoOrder[]; onDone: () => void }) {
  const { writeSite, actor } = usePartsCtx();
  const qc = useQueryClient();
  const [choices, setChoices] = useState<Record<number, string | "none">>({});
  const [busy, setBusy] = useState(false);
  const plan = dispatchDocLines(doc, orders, writeSite, choices);
  const orderName = (id: string) => {
    const o = orders.find((x) => x.id === id);
    return o ? `Commande ${o.supplier_order_ref ?? "sans n°"}${orderRep(o)}` : id;
  };
  const orderRep = (o: MoOrder) => {
    const g = plan.groups.find((x) => x.order.id === o.id);
    const r = g?.repere ?? o.requested_or_number ?? o.repair_orders?.or_number ?? null;
    return r ? ` — repère ${r}` : "";
  };
  const set = (i: number, v: string) => setChoices((c) => { const n = { ...c }; if (v) n[i] = v; else delete n[i]; return n; });

  async function submit() {
    if (!writeSite || busy) return;
    setBusy(true);
    try {
      const payloads = multiReceiptPayloads(plan, choices);
      const res = await validateMultiReceipt({ site_id: writeSite, supplier_id: doc.supplier_id, source_document_id: docId, bl_number: blNumber, payloads, complete: plan.complete }, actor);
      toast.success(`${res.created.length} réception(s) validée(s)${res.skipped ? ` · ${res.skipped} déjà enregistrée(s)` : ""}`);
      await qc.invalidateQueries();
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Réception impossible");
    } finally {
      setBusy(false);
    }
  }

  const lineSelect = (i: number, cands: { orderId: string }[], current: string | null) => (
    <select className={`${inputCls} mt-1`} aria-label={`Commande pour la ligne ${i + 1}`} value={choices[i] ?? current ?? ""} onChange={(e) => set(i, e.target.value)}>
      <option value="">{current ? "Automatique" : "— Choisir la commande —"}</option>
      {cands.map((c) => <option key={c.orderId} value={c.orderId}>{orderName(c.orderId)}</option>)}
      <option value="none">Accepter sans commande (à régulariser)</option>
    </select>
  );

  const toReceive = plan.groups.length + (plan.unmatched.some((a) => choices[a.index] === "none") ? 1 : 0);
  return (
    <div className="space-y-2 rounded-lg border-2 border-primary p-3" data-testid="multi-order">
      <p className="text-sm font-extrabold">Ce BL correspond à {plan.groups.length} commandes ouvertes</p>
      <p className="text-xs text-muted-foreground">Rapprochement ligne par ligne sur la référence exacte, parmi les commandes ouvertes de ce fournisseur. Le repère affiché vient de la commande DDA.</p>
      {plan.groups.map((g) => (
        <div key={g.order.id} className="rounded border border-border p-2 text-xs">
          <p className="font-bold">
            Commande {g.order.supplier_order_ref ?? "sans n°"} — repère {g.repere ?? "—"} — {g.lines.map((a) => `${a.line.reference} ×${a.line.quantity ?? 1}`).join(" ; ")}
          </p>
          <ul className="mt-1 space-y-1">
            {g.lines.map((a) => (
              <li key={a.index}>
                <span>{a.line.reference} ×{a.line.quantity ?? 1} — {a.line.label ?? "—"} · {a.reason}</span>
                {a.qtyOverRemaining ? <> <Badge tone="warn">Quantité supérieure au reliquat</Badge></> : null}
                {a.priceGap != null ? <span className="block text-status-warn">{PRICE_GAP_LABEL} ({a.priceGap > 0 ? "+" : ""}{eur(a.priceGap)})</span> : null}
                {a.candidates.length > 1 ? lineSelect(a.index, a.candidates, a.orderId) : null}
              </li>
            ))}
          </ul>
          <Link to="/pieces-achats/commande/$orderId" params={{ orderId: g.order.id }} target="_blank" className="underline">Voir la commande</Link>
        </div>
      ))}
      {plan.ambiguous.length ? (
        <div className="rounded border-2 border-status-warn p-2 text-xs">
          <p className="font-bold">Lignes ambiguës — choisissez la commande</p>
          {plan.ambiguous.map((a) => (
            <div key={a.index} className="mt-1">{a.line.reference} ×{a.line.quantity ?? 1} — {a.line.label ?? "—"} · {a.reason}{lineSelect(a.index, a.candidates, null)}</div>
          ))}
        </div>
      ) : null}
      {plan.unmatched.length ? (
        <div className="rounded border border-border p-2 text-xs">
          <p className="font-bold">Lignes non rapprochées</p>
          {plan.unmatched.map((a) => (
            <label key={a.index} className="mt-1 flex items-center gap-2">
              <input type="checkbox" checked={choices[a.index] === "none"} onChange={(e) => set(a.index, e.target.checked ? "none" : "")} />
              <span>{a.line.reference ?? "réf ?"} ×{a.line.quantity ?? 1} — {a.line.label ?? "—"} · {a.reason} — accepter sans commande (à régulariser)</span>
            </label>
          ))}
        </div>
      ) : null}
      {plan.globalGap != null ? <p className="text-xs text-status-warn">{PRICE_GAP_LABEL} Écart global BL / commandes : {plan.globalGap > 0 ? "+" : ""}{eur(plan.globalGap)}</p> : null}
      {!plan.complete ? <p className="text-xs text-muted-foreground">Le document restera « à traiter » tant que toutes ses lignes ne sont pas affectées ou acceptées sans commande.</p> : null}
      <button type="button" className={`${btnPrimary} w-full`} disabled={busy || !toReceive} onClick={() => void submit()}>
        {busy ? "Réception…" : `Réceptionner ${toReceive > 1 ? `les ${toReceive} réceptions` : "la réception"} en une fois`}
      </button>
      <p className="text-[11px] text-muted-foreground">Une réception par commande, toutes rattachées au même BL. Un second clic ne crée pas de doublon.</p>
    </div>
  );
}
