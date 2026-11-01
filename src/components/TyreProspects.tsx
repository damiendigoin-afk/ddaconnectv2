import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PROSPECT_LABEL, PROSPECT_STATUSES, canSetProspectStatus, eurCents, fetchAllPages, type ProspectStatus } from "@/lib/tire-v10";

type Row = {
  id: string; reference: string; created_at: string; site_key: string; customer_name: string; email: string; phone: string;
  offer_snapshot: { brand?: string | null; model?: string | null; size?: string | null; loadIndex?: string | null; speedIndex?: string | null; quantity?: number } | null;
  total_ttc_cents: number; prospect_status: ProspectStatus; delivery_status: string; pdf_path: string | null;
};
const V10_BUCKET = "tyre-commercial-quotes";
const DELIVERY: Record<string, string> = {
  delivered: "E-mails acceptés par le service d'envoi", partial: "Envoi partiel", not_delivered: "Non envoyé", sending: "Envoi non confirmé", pending: "En attente",
};

/**
 * CRM prospects du site pneus (managers ; RLS = sites accessibles). Statut modifié uniquement via
 * la RPC set_tyre_prospect_status (contrôle manager + site en base). PDF privé par URL signée 5 min.
 */
export function TyreProspects() {
  const [site, setSite] = useState<"all" | "castillon" | "lalinde">("all");
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["tyre-prospects", site],
    queryFn: async () => {
      const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await fetchAllPages<Row>((a, b) => {
        let x = db.from("tyre_commercial_requests")
          .select("id, reference, created_at, site_key, customer_name, email, phone, offer_snapshot, total_ttc_cents, prospect_status, delivery_status, pdf_path")
          .order("created_at", { ascending: false }).order("id");
        if (site !== "all") x = x.eq("site_key", site);
        return x.range(a, b);
      }, { maxRows: 2000 });
      return r;
    },
    retry: false,
  });
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ProspectStatus }) => {
      const rpc = supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      const { error } = await rpc("set_tyre_prospect_status", { _request: id, _status: status });
      if (error) throw new Error(error.message.includes("forbidden") ? "Droits insuffisants pour ce garage." : "Mise à jour impossible.");
    },
    onSuccess: () => { toast.success("Statut mis à jour"); void qc.invalidateQueries({ queryKey: ["tyre-prospects"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const openPdf = async (path: string) => {
    const { data, error } = await supabase.storage.from(V10_BUCKET).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) { toast.error("PDF inaccessible."); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };
  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold">Prospects du site pneus</h3>
        <select aria-label="Filtrer par garage" value={site} onChange={(e) => setSite(e.target.value as typeof site)} className="rounded-lg border border-border bg-background px-2 py-1 text-sm">
          <option value="all">Tous mes garages</option>
          <option value="castillon">Castillon</option>
          <option value="lalinde">Lalinde</option>
        </select>
      </div>
      {q.isError ? <p className="text-sm text-muted-foreground">Prospects indisponibles (module V10 non encore activé).</p> : null}
      {q.data?.truncated ? <p className="text-sm text-destructive">Liste limitée aux 2 000 plus récents.</p> : null}
      {q.data && q.data.rows.length === 0 ? <p className="text-sm text-muted-foreground">Aucun prospect.</p> : null}
      <ul className="divide-y divide-border">
        {q.data?.rows.map((r) => {
          const o = r.offer_snapshot ?? {};
          return (
            <li key={r.id} className="space-y-1 py-2 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">{r.reference} · {new Date(r.created_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</span>
                <span className="text-muted-foreground">{r.site_key === "lalinde" ? "Lalinde" : "Castillon"}</span>
              </div>
              <div className="break-all">{r.customer_name} · <a className="underline" href={`tel:${r.phone}`}>{r.phone}</a> · <a className="underline" href={`mailto:${r.email}`}>{r.email}</a></div>
              <div>{[o.brand, o.model].filter(Boolean).join(" ")} {o.size ?? ""} {o.loadIndex ?? ""}{o.speedIndex ?? ""} ×{o.quantity ?? "?"} · <strong>{eurCents(r.total_ttc_cents)}</strong></div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={`Statut du prospect ${r.reference}`}
                  value={r.prospect_status}
                  disabled={setStatus.isPending}
                  onChange={(e) => { const s = e.target.value as ProspectStatus; if (canSetProspectStatus(r.prospect_status, s)) setStatus.mutate({ id: r.id, status: s }); }}
                  className="rounded-lg border border-border bg-background px-2 py-1"
                >
                  {PROSPECT_STATUSES.map((s) => <option key={s} value={s}>{PROSPECT_LABEL[s]}</option>)}
                </select>
                <span className="text-xs text-muted-foreground">{DELIVERY[r.delivery_status] ?? r.delivery_status}</span>
                {r.pdf_path ? <button type="button" onClick={() => void openPdf(r.pdf_path!)} className="text-xs font-semibold underline">PDF du devis</button> : <span className="text-xs text-muted-foreground">PDF absent</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
