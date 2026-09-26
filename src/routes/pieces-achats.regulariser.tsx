import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { ageDays, Badge, OrLink, SiteFilter, usePartsCtx } from "@/components/parts/PartsUi";
import { closeRegularization, listRegularizations, REGUL_LABELS, type RegulItem } from "@/lib/parts";

export const Route = createFileRoute("/pieces-achats/regulariser")({
  head: () => ({
    meta: [
      { title: "À régulariser — DDA Connect" },
      { name: "description", content: "Anomalies pièces à traiter : réceptions sans document, stock négatif, pièces non pointées." },
      { property: "og:title", content: "À régulariser — DDA Connect" },
      { property: "og:description", content: "Anomalies Pièces & achats à régulariser." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RegulPage,
});

function RegulPage() {
  const { siteName, actor } = usePartsCtx();
  const qc = useQueryClient();
  const [scope, setScope] = useState("groupe");
  const q = useQuery({ queryKey: ["regul", scope], queryFn: () => listRegularizations(scope === "groupe" ? null : scope) });

  async function close(item: RegulItem) {
    const c = window.prompt("Commentaire de régularisation (facultatif) :");
    if (c === null) return;
    await closeRegularization(item, c, actor);
    toast.success("Régularisation clôturée (conservée dans l'historique)");
    qc.invalidateQueries({ queryKey: ["regul"] });
  }

  return (
    <AppShell title="À régulariser" subtitle="Pièces & achats" back={{ to: "/pieces-achats" }}>
      <div className="space-y-3">
        <SiteFilter value={scope} onChange={setScope} />
        {q.data && !q.data.length ? <p className="card-surface p-4 text-sm text-muted-foreground">Rien à régulariser.</p> : null}
        {(q.data ?? []).map((r) => (
          <div key={r.key} className="rounded-xl border-2 border-border bg-card p-3 text-sm">
            <div className="flex justify-between gap-2">
              <Badge tone={r.kind === "stock_negatif" || r.kind === "travaux_forces" ? "bad" : "warn"}>{REGUL_LABELS[r.kind] ?? r.kind}</Badge>
              <span className="text-xs text-muted-foreground">{ageDays(r.created_at)} j</span>
            </div>
            <div className="mt-1 text-xs">
              {siteName(r.site_id)}{r.supplier ? ` · ${r.supplier}` : ""}{r.reference ? ` · ${r.reference}` : ""}{r.plate ? ` · ${r.plate}` : ""}
            </div>
            {r.comment ? <div className="text-xs text-muted-foreground">{r.comment}</div> : null}
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <OrLink id={r.or_id} num={r.or_number} />
              {r.kind === "stock_negatif" ? <Link to="/pieces-achats/stock" className="underline">Corriger le stock</Link> : null}
              {r.kind === "commande_non_enrichie" && r.source_id ? <Link to="/pieces-achats/commande/$orderId" params={{ orderId: r.source_id }} className="underline">Voir la commande</Link> : null}
              {r.kind === "stock_negatif" && !r.id ? null : <button className="font-bold underline" onClick={() => close(r)}>Marquer régularisé</button>}
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
