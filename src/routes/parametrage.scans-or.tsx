import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { useSite } from "@/lib/site-context";
import { listOrScans, orScanPhotoUrl, runOrScanBench, setOrScanBenchConsent } from "@/lib/or-scan-log.functions";

export const Route = createFileRoute("/parametrage/scans-or")({
  head: () => ({
    meta: [
      { title: "Scans OR — journal privé et banc comparatif — DDA Connect" },
      { name: "description", content: "Suivi des lectures d'OR WinMotor : étapes, doutes, corrections et comparaison avec la lecture vision, photos conservées 30 jours." },
      { property: "og:title", content: "Scans OR — DDA Connect" },
      { property: "og:description", content: "Journal privé des lectures d'OR et banc comparatif." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScansOr,
});

type Row = Awaited<ReturnType<typeof listOrScans>>[number];
type Summary = { exact: number; wrong: number; missing: number; extra: number; scored: number };
const pct = (s?: Summary) => (s && s.scored ? `${Math.round((100 * s.exact) / s.scored)} % exacts (${s.wrong} faux, ${s.missing} manquants)` : "—");

function ScansOr() {
  const { isManager } = useAuth();
  const { site, sites } = useSite();
  const qc = useQueryClient();
  const list = useServerFn(listOrScans);
  const photo = useServerFn(orScanPhotoUrl);
  const consent = useServerFn(setOrScanBenchConsent);
  const bench = useServerFn(runOrScanBench);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["or-scan-logs", site?.id ?? null], enabled: isManager, queryFn: () => list({ data: { siteId: site?.id ?? null } }) });

  if (!isManager) return <AppShell title="Scans OR" back={{ to: "/parametrage" }}><p className="text-sm">Accès réservé aux gérants.</p></AppShell>;
  const rows = (q.data ?? []) as Row[];
  const corrected = rows.filter((r) => r.corrections?.length).length;
  const doubted = rows.filter((r) => Array.isArray(r.doubts) && r.doubts.length).length;
  const benchRows = rows.filter((r) => r.bench && (r.bench as { reference?: string }).reference === "confirmed");

  return (
    <AppShell title="Scans OR" back={{ to: "/parametrage" }}>
      <div className="space-y-3">
        <div className="card-surface space-y-1 p-4 text-sm">
          <p>Photos d'OR conservées <strong>30 jours</strong> dans un espace privé, puis supprimées automatiquement. Accès gérant uniquement, lien d'ouverture valable 5 minutes.</p>
          <p className="text-muted-foreground">{rows.length} lectures · {doubted} avec doute · {corrected} corrigées par l'opérateur · {benchRows.length} comparées</p>
        </div>
        {q.isLoading ? <p className="text-sm">Chargement…</p> : null}
        {rows.map((r) => {
          const b = r.bench as { vision?: { summary?: Summary; credits?: number; ms?: number; ai_calls?: number }; production?: { summary?: Summary; ai_calls?: number | null }; rules_only?: { summary?: Summary } | null } | null;
          return (
            <div key={r.id} className="card-surface space-y-1 p-3 text-xs">
              <div className="flex flex-wrap justify-between gap-2 font-bold">
                <span>OR {r.or_number ?? "?"} · {sites.find((s) => s.id === r.site_id)?.name ?? ""} · {r.entry}</span>
                <span>{new Date(r.created_at).toLocaleString("fr-FR")}</span>
              </div>
              <div>Par {r.user_name ?? "—"} · voie {r.route ?? "—"} · {r.ai_calls ?? 0} appel(s) IA · texte local {r.local_text_len ?? 0} car. · issue {r.outcome ?? "en cours"}</div>
              {Array.isArray(r.doubts) && r.doubts.length ? <div>Doutes : {(r.doubts as Array<{ message?: string }>).map((d) => d.message).join(" · ")}</div> : null}
              {r.corrections?.length ? <div>Champs corrigés : {r.corrections.join(", ")}</div> : null}
              {b ? (
                <div className="rounded-md bg-muted p-2">
                  <div>Production : {pct(b.production?.summary)} · {b.production?.ai_calls ?? 0} appel(s)</div>
                  <div>Vision d'abord : {pct(b.vision?.summary)} · {b.vision?.ai_calls ?? 0} appel(s) · {b.vision?.credits?.toFixed(3) ?? "0"} crédit · {Math.round((b.vision?.ms ?? 0) / 1000)} s</div>
                  <div>Règles seules (OCR local) : {pct(b.rules_only?.summary ?? undefined)}</div>
                  {!r.confirmed_fields ? <div>Sans référence confirmée : pas de score.</div> : null}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                {r.photo_path ? (
                  <button type="button" className="rounded-md bg-secondary px-2 py-1 font-bold" onClick={async () => { const { url } = await photo({ data: { id: r.id } }); if (url) window.open(url, "_blank", "noopener"); else toast.error("Photo indisponible"); }}>Voir la photo</button>
                ) : <span className="text-muted-foreground">Photo non conservée</span>}
                {r.photo_path ? (
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={r.bench_consent} onChange={async (e) => { await consent({ data: { id: r.id, consent: e.target.checked } }); void qc.invalidateQueries({ queryKey: ["or-scan-logs"] }); }} />
                    Accord banc
                  </label>
                ) : null}
                {r.photo_path && r.bench_consent ? (
                  <button type="button" disabled={busy === r.id} className="rounded-md bg-primary px-2 py-1 font-bold text-primary-foreground disabled:opacity-60"
                    onClick={async () => { setBusy(r.id); try { await bench({ data: { id: r.id } }); toast.success("Comparaison enregistrée"); void qc.invalidateQueries({ queryKey: ["or-scan-logs"] }); } catch (e) { toast.error(e instanceof Error ? e.message : "Comparaison impossible"); } finally { setBusy(null); } }}>
                    {busy === r.id ? "Comparaison…" : "Comparer avec vision"}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
