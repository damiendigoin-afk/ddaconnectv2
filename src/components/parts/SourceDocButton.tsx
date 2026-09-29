import { useState } from "react";
import { FileText, Download } from "lucide-react";
import { toast } from "sonner";

import { orderSourceDoc } from "@/lib/order-docs-rules";
import { orderDocSignedUrl } from "@/lib/order-docs";

/** « Document source » d'une commande : rien si la commande n'a pas de document. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SourceDocButton({ o, compact = false }: { o: any; compact?: boolean }) {
  const doc = orderSourceDoc(o);
  const [busy, setBusy] = useState(false);
  if (!doc) return null;
  async function open(download: boolean) {
    setBusy(true);
    // Onglet ouvert tout de suite (Safari bloque window.open après un await).
    const w = download ? null : window.open("", "_blank");
    const url = await orderDocSignedUrl(doc!.storagePath, download);
    setBusy(false);
    if (!url) { w?.close(); return void toast.error("Document inaccessible (droits du site ou fichier absent)."); }
    if (w) w.location.href = url; else window.location.href = url;
  }
  const cls = "inline-flex items-center gap-1 rounded-md border-2 border-border px-2 py-1 text-xs font-bold";
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <button type="button" className={cls} disabled={busy} onClick={() => void open(false)} title={doc.fileName}>
        <FileText className="h-3.5 w-3.5" /> Document source
      </button>
      {compact ? null : (
        <button type="button" className={cls} disabled={busy} onClick={() => void open(true)} aria-label="Télécharger le document source">
          <Download className="h-3.5 w-3.5" /> Télécharger
        </button>
      )}
      {compact ? null : <span className="text-xs text-muted-foreground">{doc.fileName}{doc.size ? ` · ${Math.max(1, Math.round(doc.size / 1024))} Ko` : ""}</span>}
    </div>
  );
}
