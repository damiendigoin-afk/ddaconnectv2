import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { SITE_LABELS, ImportError, parseWorkbookSheets, readWorkbook, type ParsedWorkbook } from "@/lib/activity/parse";
import { saveWorkbook } from "@/lib/activity/store";
import { periodLabel } from "@/lib/stats";

export const Route = createFileRoute("/statistiques/activite/import")({
  head: () => ({
    meta: [
      { title: "Import du suivi d'activité — DDA Connect" },
      {
        name: "description",
        content: "Import déterministe du fichier Excel de suivi mensuel d'une société, avec rapport d'anomalies détaillé.",
      },
      { property: "og:title", content: "Import du suivi d'activité — DDA Connect" },
      { property: "og:description", content: "Lecture des onglets mensuels et contrôle des données manquantes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ActivityImport,
});

function ActivityImport() {
  const { user, displayName } = useAuth();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function analyze(f: File) {
    setBusy(true);
    setError(null);
    setParsed(null);
    try {
      const sheets = await readWorkbook(f);
      setParsed(parseWorkbookSheets(sheets));
      setFile(f);
    } catch (e) {
      setError(e instanceof ImportError ? e.message : "Fichier illisible : vérifiez qu'il s'agit bien du tableau de suivi Excel.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!parsed) return;
    setBusy(true);
    try {
      await saveWorkbook(parsed, {
        fileName: file?.name ?? null,
        userId: user?.id ?? null,
        userName: displayName ?? null,
      });
      toast.success(`${parsed.months.length} mois importés`);
      void navigate({ to: "/statistiques/activite" });
    } catch {
      toast.error("Import interrompu : aucune donnée existante n'a été écrasée pour les mois non traités.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Importer Excel" subtitle="Suivi d'activité" back={{ to: "/statistiques/activite" }}>
      <div className="space-y-4">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border p-8 text-center">
          <Upload className="h-6 w-6 text-brand" />
          <span className="text-sm font-extrabold uppercase">Choisir le fichier Excel d'une société</span>
          <span className="text-xs text-muted-foreground">1 fichier par société · lecture locale, sans IA</span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void analyze(f);
            }}
          />
        </label>

        {busy ? <p className="text-center text-sm text-muted-foreground">Lecture en cours…</p> : null}

        {error ? (
          <div className="rounded-xl border-2 border-destructive p-4 text-sm">
            <p className="flex items-center gap-2 font-extrabold uppercase text-destructive">
              <AlertTriangle className="h-4 w-4" /> Import refusé
            </p>
            <p className="mt-1 text-muted-foreground">{error}</p>
          </div>
        ) : null}

        {parsed ? (
          <>
            <div className="card-surface space-y-2 p-4 text-sm">
              <p className="flex items-center gap-2 font-extrabold uppercase">
                <CheckCircle2 className="h-4 w-4 text-brand" /> {SITE_LABELS[parsed.site]}
              </p>
              <p className="text-muted-foreground">
                {parsed.months.length} onglet(s) mensuel(s) reconnu(s) · {parsed.valuesCount} valeurs lues ·{" "}
                {parsed.anomalies.length} anomalie(s)
              </p>
              <ul className="space-y-1 text-xs">
                {parsed.months.map((m) => (
                  <li key={m.sheet} className="flex justify-between border-t border-border pt-1">
                    <span className="font-bold">
                      {m.sheet} — {periodLabel(m.periodStart)}
                    </span>
                    <span className="text-muted-foreground">{m.recognized} valeurs</span>
                  </li>
                ))}
              </ul>
              {parsed.skippedSheets.length ? (
                <p className="text-xs text-muted-foreground">
                  Onglets ignorés (mois non identifié) : {parsed.skippedSheets.join(", ")}
                </p>
              ) : null}
            </div>

            {parsed.anomalies.length ? (
              <div className="card-surface space-y-1 p-4">
                <p className="text-xs font-bold uppercase tracking-widest text-status-watch">Données manquantes</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {parsed.anomalies.slice(0, 80).map((a, i) => (
                    <li key={i}>{a.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Un mois déjà importé sera intégralement remplacé par cette version. Les cellules vides restent vides, elles
              ne sont jamais converties en zéro.
            </p>

            <button
              disabled={busy}
              onClick={() => void confirm()}
              className="w-full rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50"
            >
              Valider l'import
            </button>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
