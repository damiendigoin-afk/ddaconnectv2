import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

const NOTIF: Record<string, string> = {
  pending: "Notification en cours",
  sent: "Garage notifié",
  failed: "Échec de notification",
  not_configured: "Adresse d'accueil absente",
};

/** Demandes de RDV reçues du site DDA Pneus (managers), avec état de notification du garage. */
export function TireWebAppointments() {
  const q = useQuery({
    queryKey: ["tire-web-appointments"],
    queryFn: async () => {
      const [r, s] = await Promise.all([
        supabase
          .from("tire_web_appointment_requests")
          .select("id, created_at, status, customer_name, phone, email, preferred_slots, offer_snapshot, site_id, notification_status, notification_error")
          .order("created_at", { ascending: false })
          .limit(30),
        supabase.from("sites").select("id, name"),
      ]);
      if (r.error) throw r.error;
      return { rows: r.data ?? [], sites: s.data ?? [] };
    },
  });
  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-bold">Demandes de rendez-vous du site pneus</h3>
      {q.isError ? <p className="text-sm text-destructive">Lecture impossible.</p> : null}
      {q.data && q.data.rows.length === 0 ? <p className="text-sm text-muted-foreground">Aucune demande reçue.</p> : null}
      <ul className="divide-y divide-border">
        {q.data?.rows.map((r) => {
          const o = r.offer_snapshot as { brand?: string; model?: string; totalTtcCents?: number } | null;
          const bad = r.notification_status === "failed" || r.notification_status === "not_configured";
          return (
            <li key={r.id} className="py-2 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">{r.customer_name}</span>
                <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString("fr-FR")}</span>
              </div>
              <div className="text-muted-foreground">
                {q.data.sites.find((s) => s.id === r.site_id)?.name ?? "—"} · {[o?.brand, o?.model].filter(Boolean).join(" ")}
                {o?.totalTtcCents != null ? ` · ${(o.totalTtcCents / 100).toFixed(2)} € TTC` : ""} · {r.phone ?? r.email}
              </div>
              <div className={bad ? "text-destructive" : "text-muted-foreground"}>
                {r.status === "a_confirmer" ? "À confirmer" : r.status} · {NOTIF[r.notification_status] ?? r.notification_status}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
