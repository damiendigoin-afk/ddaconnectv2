import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { aggregateTraffic, fetchAllPages, type EventRow, type RequestLite } from "@/lib/tire-v10";

const WD = ["", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/**
 * Tableau de bord trafic DDA Pneus (managers, RLS). Lit les tables V10 ;
 * tant que la migration V10 n'est pas appliquée, affiche un état explicite.
 */
export function TyreWebTrafficDashboard({ days = 7 }: { days?: number }) {
  const q = useQuery({
    queryKey: ["tyre-web-traffic", days],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
      // Pagination explicite (plafond API 1000 lignes/requête) ; plafond dur signalé, jamais silencieux.
      const [e, r] = await Promise.all([
        fetchAllPages<EventRow>((a, b) => db.from("tyre_web_events").select("*").gte("occurred_at", since).order("occurred_at").order("event_id").range(a, b)),
        fetchAllPages<RequestLite>((a, b) => db.from("tyre_commercial_requests").select("created_at, site_key, prospect_status, delivery_status").gte("created_at", since).order("created_at").order("request_id").range(a, b)),
      ]);
      return { ...aggregateTraffic(e.rows, r.rows), truncated: e.truncated || r.truncated };
    },
    retry: false,
  });
  const top = (m: Record<string, number>, label?: (k: string) => string) =>
    Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${label ? label(k) : k} : ${v}`).join(" · ") || "—";
  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-bold">Trafic du site pneus ({days} derniers jours)</h3>
      {q.isError ? <p className="text-sm text-muted-foreground">Statistiques indisponibles (module V10 non encore activé).</p> : null}
      {q.data ? (
        <div className="space-y-1 text-sm">
          <p>Pages vues {q.data.totals.pageViews} · sessions {q.data.totals.sessionStarts} · devis {q.data.totals.quotes} · offres choisies {q.data.totals.offerSelected} · demandes {q.data.totals.requests}</p>
          <p className="text-muted-foreground">
            Couverture du consentement : {Math.round(q.data.consentCoverage.ratio * 100)} % des événements reçus (et non des visiteurs totaux). Visiteurs distincts ({q.data.consentCoverage.distinctVisitorsConsented}) comptés seulement parmi les consentants.
          </p>
          {q.data.truncated ? <p className="text-sm font-semibold text-destructive">Volume au-delà du plafond de lecture : chiffres incomplets.</p> : null}
          <p>Heures : {top(q.data.byHour, (k) => `${k} h`)}</p>
          <p>Jours : {top(q.data.byWeekday, (k) => WD[Number(k)] ?? k)}</p>
          <p>Provenance : {top(q.data.bySource)} — Appareils : {top(q.data.byDevice)}</p>
          <p>Dimensions : {top(q.data.bySize)} — Gammes : {top(q.data.byTier)}</p>
          <p>Abandons après devis {q.data.funnel.abandonsAfterQuote} · après choix {q.data.funnel.abandonsAfterSelection}</p>
          <p>Demandes Castillon {q.data.requestsBySite['castillon'] ?? 0} · Lalinde {q.data.requestsBySite['lalinde'] ?? 0} — Vendus Castillon {q.data.soldBySite['castillon'] ?? 0} · Lalinde {q.data.soldBySite['lalinde'] ?? 0}</p>
        </div>
      ) : null}
    </section>
  );
}
