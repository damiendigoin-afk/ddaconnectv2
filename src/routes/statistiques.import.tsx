import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { fetchModuleAccess } from "@/lib/access";
import { fetchUsers } from "@/lib/users";
import { blobToDataUrl } from "@/lib/photo";
import { ocrProductivityReport } from "@/lib/ocr.functions";
import { toastError } from "@/lib/errors";
import {
  endOfMonth,
  fetchOperators,
  findExistingImport,
  hours,
  parseReportJson,
  pct,
  periodLabel,
  saveImport,
  uploadReportFile,
  type ImportRow,
  type ProdImport,
} from "@/lib/stats";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/statistiques/import")({
  head: () => ({
    meta: [
      { title: "Import productivité Winmotor — DDA Connect" },
      {
        name: "description",
        content: "Import mensuel du rapport Winmotor de productivité : lecture automatique, contrôle et rapprochement des productifs.",
      },
      { property: "og:title", content: "Import productivité Winmotor — DDA Connect" },
      { property: "og:description", content: "Lecture automatique du rapport mensuel et rapprochement des collaborateurs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ImportPage,
});

type Draft = {
  siteLabel: string | null;
  periodStart: string;
  periodEnd: string;
  rows: ImportRow[];
  fileName: string;
};

function ImportPage() {
  const { user, isManager, displayName } = useAuth();
  const uid = user?.id ?? "";
  const nav = useNavigate();
  const qc = useQueryClient();
  const access = useQuery({ queryKey: ["access", uid], queryFn: () => fetchModuleAccess(uid), enabled: !!uid });
  const users = useQuery({ queryKey: ["users"], queryFn: fetchUsers, enabled: !!uid });
  const sites = useQuery({
    queryKey: ["sites"],
    queryFn: async () => {
      const { data } = await supabase.from("sites").select("id, name").eq("active", true).order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [siteId, setSiteId] = useState<string>("");
  const [existing, setExisting] = useState<ProdImport | null>(null);

  const allowed = isManager || access.data?.has("stats_import");

  async function onFile(f: File) {
    setBusy(true);
    try {
      const dataUrl = await blobToDataUrl(f);
      const res = await ocrProductivityReport({ data: { dataUrl, filename: f.name } });
      if (!res.ok) throw new Error(res.error);
      const ops = await fetchOperators();
      const parsed = parseReportJson(res.json, ops);
      if (!parsed.period_start) {
        toast.error("Période introuvable", {
          description: "Le titre du rapport n'a pas pu être lu. Vérifiez que le PDF complet est envoyé, puis réessayez.",
        });
        return;
      }
      if (!parsed.rows.length) {
        toast.error("Aucun productif détecté", {
          description: "Le rapport ne contient aucune ligne exploitable. Réexportez-le depuis Winmotor.",
        });
        return;
      }
      const start = parsed.period_start.slice(0, 8) + "01";
      const matchedSite =
        (sites.data ?? []).find((s) => s.name.toLowerCase() === (parsed.site ?? "").toLowerCase())?.id ??
        (sites.data ?? [])[0]?.id ??
        "";
      setSiteId(matchedSite);
      setFile(f);
      setDraft({
        siteLabel: parsed.site,
        periodStart: start,
        periodEnd: parsed.period_end ?? endOfMonth(start),
        rows: parsed.rows,
        fileName: f.name,
      });
      setExisting(await findExistingImport(matchedSite || null, start));
    } catch (e) {
      toastError(e, "Lecture du rapport impossible");
    } finally {
      setBusy(false);
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      const path = file ? await uploadReportFile(file) : null;
      await saveImport({
        siteId: siteId || null,
        siteLabel: draft.siteLabel,
        periodStart: draft.periodStart,
        periodEnd: draft.periodEnd,
        rows: draft.rows,
        fileName: draft.fileName,
        storagePath: path,
        importedBy: uid || null,
        importedByName: displayName || null,
        replaceId: existing?.id ?? null,
      });
    },
    onSuccess: async () => {
      toast.success("Productivité importée");
      await qc.invalidateQueries();
      void nav({ to: "/statistiques/equipe" });
    },
    onError: (e) => toastError(e, "Import de la productivité impossible"),
  });

  if (!allowed) {
    return (
      <AppShell title="Import productivité" back={{ to: "/statistiques" }}>
        <div className="card-surface p-5 text-sm">
          <p className="font-bold uppercase">Accès réservé</p>
          <p className="mt-1 text-muted-foreground">L'import des statistiques Winmotor n'est pas activé sur votre profil.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Import productivité" subtitle="Rapport Winmotor mensuel" back={{ to: "/statistiques" }}>
      <div className="space-y-4">
        {!draft ? (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-card px-4 py-10 text-center">
            {busy ? <Loader2 className="h-6 w-6 animate-spin text-brand" /> : <FileUp className="h-6 w-6 text-brand" />}
            <span className="text-sm font-extrabold uppercase">
              {busy ? "Lecture du rapport…" : "Choisir le rapport Winmotor"}
            </span>
            <span className="text-xs text-muted-foreground">
              PDF ou image du rapport « Ratios de productivité et de rentabilité ». La période est lue dans le document.
            </span>
            <input
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </label>
        ) : (
          <>
            <div className="card-surface space-y-3 p-4">
              <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Période détectée</div>
              <div className="text-xl font-extrabold uppercase text-brand">
                {periodLabel(draft.periodStart, draft.periodEnd)}
              </div>
              <p className="text-xs text-muted-foreground">{draft.fileName}</p>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Établissement
                </span>
                <select
                  value={siteId}
                  onChange={async (e) => {
                    setSiteId(e.target.value);
                    setExisting(await findExistingImport(e.target.value || null, draft.periodStart));
                  }}
                  className="w-full rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold"
                >
                  {(sites.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              {existing ? (
                <p className="rounded-lg bg-status-watch-soft px-3 py-2 text-xs font-bold text-status-watch">
                  Un import existe déjà pour cette période. Valider remplacera les données ; l'ancien import restera
                  visible dans l'historique.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              {draft.rows.map((r, i) => (
                <div key={`${r.name}-${i}`} className="card-surface space-y-2 p-4">
                  <div className="text-sm font-extrabold uppercase">{r.name}</div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>Achetées {hours(r.hours_purchased)}</span>
                    <span>Passées {hours(r.hours_spent)}</span>
                    <span>Facturées {hours(r.hours_billed)}</span>
                    <span className="font-bold text-foreground">Prod. {pct(r.productivity)}</span>
                    <span className="font-bold text-foreground">Rent. {pct(r.profitability)}</span>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Utilisateur DDA Connect
                    </span>
                    <select
                      value={r.userId ?? ""}
                      onChange={(e) =>
                        setDraft((d) =>
                          d
                            ? {
                                ...d,
                                rows: d.rows.map((row, j) =>
                                  j === i ? { ...row, userId: e.target.value || null } : row,
                                ),
                              }
                            : d,
                        )
                      }
                      className={`w-full rounded-lg border-2 px-3 py-2 text-sm font-bold ${
                        r.userId ? "border-border bg-card" : "border-status-watch bg-status-watch-soft"
                      }`}
                    >
                      <option value="">Non rattaché</option>
                      {(users.data ?? []).map((u) => (
                        <option key={u.id} value={u.id}>
                          {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setDraft(null);
                  setFile(null);
                  setExisting(null);
                }}
                className="flex-1 rounded-xl border-2 border-border bg-card px-4 py-4 text-sm font-extrabold uppercase"
              >
                Annuler
              </button>
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="flex-[2] rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-60"
              >
                {save.isPending ? "Enregistrement…" : existing ? "Remplacer l'import" : "Valider l'import"}
              </button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
