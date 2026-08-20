<<<<<<< placeholder
import { AlertTriangle, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useUploadState } from "@/lib/upload-tracker";

/** Affiche l'état des envois photo et les échecs à traiter avant la clôture. */
export function PendingUploadsGuard() {
  const { pending, failed } = useUploadState();
  if (!pending && !failed.length) return null;

  return (
    <div className="mb-3 space-y-2 rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-amber-950">
      {pending ? (
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Loader2 className="h-4 w-4 animate-spin" /> {pending} photo(s) en cours d'envoi…
        </p>
      ) : null}
      {failed.length ? (
        <>
          <p className="flex items-center gap-2 text-sm font-bold">
            <AlertTriangle className="h-4 w-4" /> Une ou plusieurs photos n'ont pas été enregistrées.
            Réessayer avant de terminer le Tour.
          </p>
          {failed.map((f) => (
            <div key={f.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => {
                  void f
                    .retry()
                    .then(() => toast.success("Photo enregistrée"))
                    .catch(() => toast.error("Nouvel échec de l'envoi"));
                }}
                className="flex items-center gap-1 rounded-lg border-2 border-amber-500 px-2 py-1 text-xs font-bold uppercase"
              >
                <RefreshCw className="h-3 w-3" /> Réessayer
              </button>
              <button
                type="button"
                onClick={f.dismiss}
                aria-label="Abandonner cette photo"
                className="rounded-lg bg-destructive p-1.5 text-destructive-foreground"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}