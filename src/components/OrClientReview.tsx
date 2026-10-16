import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { SUSPICION_LABELS, clientSuspicions } from "@/lib/garage-identity";
import { candidateLabel, captureSummary, type ClientCandidate } from "@/lib/or-client-review";

type Capture = { id: string; data: Record<string, unknown>; reason: string; created_at: string };

/**
 * Revue de la fiche client d'un OR : signale une fiche polluée, affiche le brouillon de capture
 * et propose les fiches WinMotor du même site. Rien n'est modifié sans clic explicite.
 */
export function OrClientReview({ orId, client, userName }: { orId: string; client: Record<string, unknown> | null; userName?: string | null }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [ln, setLn] = useState("");
  const [fn, setFn] = useState("");
  const flags = clientSuspicions(client);

  const captures = useQuery({
    queryKey: ["or-client-captures", orId],
    queryFn: async () => {
      const { data, error } = await supabase.from("or_client_captures").select("id,data,reason,created_at").eq("repair_order_id", orId).eq("status", "pending").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Capture[];
    },
  });
  const needsReview = flags.length > 0 && !(flags.length === 1 && flags[0] === "client_absent" && !(captures.data ?? []).length);
  const candidates = useQuery({
    queryKey: ["or-client-candidates", orId],
    enabled: needsReview || (captures.data ?? []).length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("or_client_candidates", { _or: orId });
      if (error) throw error;
      return (data ?? []) as unknown as ClientCandidate[];
    },
  });
  const cap = captures.data?.[0];
  if (!needsReview && !cap) return null;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["order", orId] });
    void qc.invalidateQueries({ queryKey: ["or-client-captures", orId] });
    void qc.invalidateQueries({ queryKey: ["or-client-candidates", orId] });
  };
  async function run(key: string, fnc: () => PromiseLike<{ error: unknown }>, ok: string) {
    setBusy(key);
    const { error } = await fnc();
    setBusy(null);
    if (error) { console.error(error); toast.error("Action impossible. Réessayez ou corrigez la fiche manuellement."); return; }
    toast.success(ok);
    refresh();
  }

  return (
    <section className="card-surface space-y-3 border border-warning/40 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4 text-warning" /> Fiche client à vérifier
      </div>
      {flags.filter((f) => f !== "client_absent" || cap).length ? (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {flags.map((f) => <li key={f}>{SUSPICION_LABELS[f]}</li>)}
        </ul>
      ) : null}
      {cap ? (
        <div className="rounded-lg bg-secondary p-3 text-sm">
          <div className="font-medium">Coordonnées lues sur l'OR (non enregistrées dans une fiche)</div>
          <div className="text-muted-foreground">{captureSummary(cap.data) || "—"}</div>
        </div>
      ) : null}
      {candidates.isLoading ? <p className="text-sm text-muted-foreground">Recherche dans le fichier WinMotor du site…</p> : null}
      {(candidates.data ?? []).map((c) => (
        <div key={c.customer_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
          <div>
            <div className="font-medium">{candidateLabel(c)}</div>
            <div className="text-muted-foreground">
              {[c.account_match ? "même n° de compte" : null, c.vehicle_match ? "même véhicule" : null, c.name_match ? "nom cohérent" : null].filter(Boolean).join(" · ")}
            </div>
          </div>
          <button
            className="rounded-lg bg-brand px-3 py-2 text-brand-foreground disabled:opacity-50"
            disabled={!!busy}
            onClick={() => run(c.customer_id, () => supabase.rpc("link_or_client_from_referential", { _or: orId, _customer: c.customer_id, _user_name: userName ?? undefined }), "Client rattaché à l'OR")}
          >
            {busy === c.customer_id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Rattacher ce client"}
          </button>
        </div>
      ))}
      {candidates.data && !candidates.data.length ? (
        <p className="text-sm text-muted-foreground">Aucune fiche WinMotor cohérente sur ce site.</p>
      ) : null}
      {cap ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className="rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Nom" value={ln} onChange={(e) => setLn(e.target.value)} />
            <input className="rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Prénom" value={fn} onChange={(e) => setFn(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-lg bg-secondary px-3 py-2 text-sm font-semibold disabled:opacity-50"
              disabled={!!busy || !ln.trim()}
              onClick={() => run("create", () => supabase.rpc("create_or_client_from_capture", { _capture: cap.id, _last_name: ln.trim(), _first_name: fn.trim() || undefined, _user_name: userName ?? undefined }), "Fiche client créée")}
            >
              Créer la fiche avec ces coordonnées
            </button>
            <button
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground disabled:opacity-50"
              disabled={!!busy}
              onClick={() => run("dismiss", () => supabase.rpc("dismiss_or_client_capture", { _capture: cap.id, _user_name: userName ?? undefined }), "Brouillon ignoré")}
            >
              Ignorer ces coordonnées
            </button>
          </div>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">Correction manuelle possible via « Modifier ». Les anciennes fiches ne sont jamais modifiées automatiquement.</p>
    </section>
  );
}
