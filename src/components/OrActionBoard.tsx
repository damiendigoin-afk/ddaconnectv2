import { CheckCircle2, Hourglass, Package, PackagePlus, Play, Square } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Tableau d'actions terrain du dossier OR (V3).
 * - Sans OR WinMotor officiel : aucun pointage (temps, pièces) ni « Travaux terminés ».
 * - « Arrêter » le temps n'est PAS « Travaux terminés » : deux actions distinctes.
 * Les sous-workflows arrivent avec le lot Pièces & achats : rien n'est simulé ici.
 */
type Action = { key: string; label: string; icon: LucideIcon };

const ACTIONS: Action[] = [
  { key: "time_start", label: "Démarrer le temps", icon: Play },
  { key: "time_stop", label: "Arrêter le temps", icon: Square },
  { key: "parts_status", label: "Statut des pièces", icon: Package },
  { key: "parts_point", label: "Pointer pièces / consommables", icon: PackagePlus },
  { key: "work_done", label: "Travaux terminés", icon: CheckCircle2 },
];

export function OrActionBoard({ hasOfficialOr }: { hasOfficialOr: boolean }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Actions atelier</h2>
      {!hasOfficialOr ? (
        <div className="rounded-xl border-2 border-status-watch bg-status-watch-soft px-4 py-3 text-sm">
          <div className="flex items-center gap-2 font-extrabold uppercase">
            <Hourglass className="h-4 w-4" /> Dossier DDA — en attente OR WinMotor
          </div>
          <p className="text-xs text-muted-foreground">
            Pointage du temps, des pièces et « Travaux terminés » disponibles uniquement une fois l'OR créé dans
            WinMotor et rattaché. Le Tour véhicule et l'Expertise restent possibles.
          </p>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        {ACTIONS.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.key}
              type="button"
              disabled
              aria-disabled
              className="flex flex-col items-start gap-1 rounded-xl border-2 border-border bg-card px-3 py-3 text-left opacity-60"
            >
              <Icon className="h-5 w-5 text-brand" />
              <span className="text-xs font-extrabold uppercase">{a.label}</span>
              <span className="text-[10px] text-muted-foreground">
                {hasOfficialOr ? "Disponible avec le lot Pièces & achats" : "Nécessite un OR WinMotor"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
