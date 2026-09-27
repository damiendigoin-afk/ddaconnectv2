import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ActiveSiteNote, inputCls, ORDER_STATUS, usePartsCtx } from "@/components/parts/PartsUi";
import { listOrders } from "@/lib/parts";
import { OrderRow } from "@/components/parts/OrderRow";

export const Route = createFileRoute("/pieces-achats/historique")({
  head: () => ({
    meta: [
      { title: "Historique des commandes — DDA Connect" },
      { name: "description", content: "Toutes les commandes fournisseurs du site actif, y compris reçues et annulées." },
      { property: "og:title", content: "Historique des commandes — DDA Connect" },
      { property: "og:description", content: "Historique des commandes pièces." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const { readSite, siteName } = usePartsCtx();
  const [status, setStatus] = useState("");
  const q = useQuery({ queryKey: ["part-orders", readSite, status], queryFn: () => listOrders({ siteId: readSite, ...(status ? { status } : {}) }) });
  return (
    <AppShell title="Historique commandes" subtitle="Pièces & achats" back={{ to: "/pieces-achats" }}>
      <div className="space-y-3">
        <ActiveSiteNote />
        <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous statuts</option>
          {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {q.isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
        {q.data && !q.data.length ? <p className="card-surface p-4 text-sm text-muted-foreground">Aucune commande.</p> : null}
        {(q.data ?? []).map((o) => <OrderRow key={o.id} o={o} siteName={siteName} />)}
      </div>
    </AppShell>
  );
}
