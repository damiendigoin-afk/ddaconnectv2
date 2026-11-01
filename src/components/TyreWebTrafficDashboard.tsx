import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { aggregateTrafficV2, fetchAllPages, parisMidnightUtc, lastParisDays, type EventRow, type RequestLite } from "@/lib/tire-v10";

const pct = (x: number | null) => (x == null ? "Non calculable" : `${Math.round(x * 100)} %`);

/**
 * Tableau de bord trafic DDA Pneus (managers, RLS). Lecture seule des tables V10, indépendante du
 * moteur de prix et du configurateur. Entonnoir calculé sur la cohorte consentie uniquement.
 */
export function TyreWebTrafficDashboard() {
  const q = useQuery({
    queryKey: ["tyre-web-traffic-v2"],
    queryFn: async () => {
      const now = new Date();
      const since = parisMidnightUtc(lastParisDays(now)[0]!).toISOString();
      const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
      // Pagination explicite (plafond API 1000 lignes/requête) ; plafond dur signalé, jamais silencieux.
      const [e, r] = await Promise.all([
        fetchAllPages<EventRow>((a, b) => db.from("tyre_web_events").select("*").gte("occurred_at", since).order("occurred_at").order("event_id").range(a, b)),
        fetchAllPages<RequestLite>((a, b) => db.from("tyre_commercial_requests").select("created_at, site_key, prospect_status, delivery_status").gte("created_at", since).order("created_at").order("id").range(a, b)),
      ]);
      return { ...aggregateTrafficV2(e.rows, r.rows, now), truncated: e.truncated || r.truncated };
    },
    retry: false,
  });
  const top = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} : ${v}`).join(" · ") || "—";
  const d = q.data;
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-bold">Trafic du site pneus (7 derniers jours, heure de Paris)</h3>
      {q.isError ? <p className="text-sm text-muted-foreground">Statistiques indisponibles (module V10 non encore activé).</p> : null}
      {d ? (
        <div className="space-y-3 text-sm">
          {d.truncated ? <p className="font-semibold text-destructive">Volume au-delà du plafond de lecture : chiffres incomplets.</p> : null}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground"><tr><th className="py-1">Date</th><th>Pages vues</th><th>Devis</th><th>Demandes enregistrées</th><th>E-mails acceptés</th></tr></thead>
              <tbody>
                {d.daily.map((x) => (
                  <tr key={x.day} className="border-t border-border"><td className="py-1">{x.day.split("-").reverse().join("/")}</td><td>{x.pageViews}</td><td>{x.quotes}</td><td>{x.requestsRecorded}</td><td>{x.requestsDelivered}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>Demandes (tous visiteurs) : {d.requestsGlobal.recorded} enregistrées, dont {d.requestsGlobal.delivered} avec e-mails acceptés par le service d'envoi · Castillon {d.requestsBySite['castillon'] ?? 0} · Lalinde {d.requestsBySite['lalinde'] ?? 0}</p>
          <div>
            <p className="font-semibold">Parcours des visiteurs ayant consenti à la mesure ({d.cohort.visitors})</p>
            <p>Visite → devis {pct(d.cohort.visitToQuote)} · devis → demande {pct(d.cohort.quoteToRequest)} · visite → demande {pct(d.cohort.visitToRequest)}</p>
            <p>Choix d'offre sans demande (par devis) : {d.cohort.abandonedSelections ?? "Non calculable"}</p>
            <p className="text-xs text-muted-foreground">
              Couverture : {Math.round(d.consentCoverage.ratio * 100)} % des événements reçus sont consentis (pas une proportion des visiteurs totaux). Les taux ne portent que sur cette cohorte.
            </p>
          </div>
          <p>Provenance : {top(d.bySource)} — Appareils : {top(d.byDevice)}</p>
          <p>Dimensions demandées : {top(d.bySize)} — Gammes choisies : {top(d.byTier)}</p>
          <p>Marques choisies (offre serveur vérifiée) : {top(d.byOfferBrandVerified)}</p>
        </div>
      ) : null}
    </section>
  );
}
