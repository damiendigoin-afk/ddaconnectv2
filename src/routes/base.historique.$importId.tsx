import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/base/historique/$importId")({
  head: () => ({
    meta: [
      { title: "Détail d'un import — DDA Connect" },
      { name: "description", content: "Compteurs et anomalies détaillées d'un import Winmotor dans DDA Connect." },
      { property: "og:title", content: "Détail d'un import — DDA Connect" },
      { property: "og:description", content: "Compteurs et anomalies d'un import Winmotor." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ImportDetail,
});

async function fetchDetail(id: string) {
  const [{ data: imp }, { data: rows, count }] = await Promise.all([
    supabase.from("imports").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("import_rows")
      .select("row_number, source_vehicle_id, source_customer_id, processing_errors", { count: "exact" })
      .eq("import_id", id)
      .eq("processing_status", "anomaly")
      .order("row_number")
      .limit(200),
  ]);
  return { imp, rows: rows ?? [], anomalyCount: count ?? 0 };
}

function ImportDetail() {
  const { importId } = Route.useParams();
  const { isManager } = useAuth();
  const { data } = useQuery({ queryKey: ["import", importId], queryFn: () => fetchDetail(importId), enabled: isManager });

  if (!isManager) {
    return (
      <AppShell title="Import" back={{ to: "/base/historique" }}>
        <p className="card-surface p-5 text-sm text-muted-foreground">Réservé aux managers.</p>
      </AppShell>
    );
  }

  const i = data?.imp;

  return (
    <AppShell title="Détail de l'import" subtitle={i?.file_name} back={{ to: "/base/historique" }}>
      <div className="space-y-4">
        {i ? (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <S label="Lignes" v={i.total_rows} />
            <S label="Colonnes" v={i.total_columns} />
            <S label="Clients créés" v={i.customers_created} />
            <S label="Clients mis à jour" v={i.customers_updated} />
            <S label="Véhicules créés" v={i.vehicles_created} />
            <S label="Véhicules mis à jour" v={i.vehicles_updated} />
            <S label="Relations" v={i.relations_created} />
            <S label="Coordonnées" v={i.contacts_imported} />
            <S label="Adresses" v={i.addresses_imported} />
            <S label="Kilométrages" v={i.mileages_imported} />
            <S label="Doublons évités" v={i.duplicates_avoided} />
            <S label="Anomalies" v={i.anomalies} />
          </dl>
        ) : null}

        <section className="space-y-2">
          <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Anomalies ({data?.anomalyCount ?? 0})
          </h2>
          {!data?.rows.length ? (
            <p className="card-surface p-4 text-sm text-muted-foreground">Aucune anomalie détectée.</p>
          ) : (
            <ul className="card-surface divide-y divide-border">
              {data.rows.map((r) => (
                <li key={r.row_number} className="px-4 py-2 text-sm">
                  <span className="font-bold">Ligne {r.row_number}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    — {(r.processing_errors ?? []).join(", ") || "anomalie"}
                    {r.source_vehicle_id ? ` (véhicule ${r.source_vehicle_id})` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function S({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded-lg bg-secondary px-3 py-2">
      <dt className="text-[11px] uppercase text-muted-foreground">{label}</dt>
      <dd className="text-lg font-extrabold">{v.toLocaleString("fr-FR")}</dd>
    </div>
  );
}
